import {
  ATTESTATION_DISCLAIMER,
  ATTESTATION_JWS_TYP,
  ATTESTATION_TYPE,
  POSTURE_SEVERITIES,
  coverageShares,
  formatUsd,
  micros,
  type AttestationDocument,
  type CheckResult,
  type PostureStatus,
} from '@aperture/core';
import {
  GENESIS_HASH,
  decryptSecret,
  encryptSecret,
  generateSigningKey,
  merkleRoot,
  signJws,
  verifyChain,
  type KeyRing,
  type PublicJwk,
} from '@aperture/crypto';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { exportAuditEvents } from './audit';
import type { DbOrTx } from './client';
import { dbNow } from './ledger';
import { coverageAmounts } from './posture';
import {
  attestations,
  auditAnchors,
  orgSettings,
  orgs,
  platformSigningKeys,
  postureRuns,
  postureWaivers,
  principals,
} from './schema';

/*
 * Signed governance attestations (plan/phases/phase-11 §11.5, ADR 0020). The platform key signs
 * on Aperture Cloud; a self-hosted install has its own instance key in the same table, and the
 * issuer field says which. Retired keys stay published so old attestations keep verifying.
 */

const platformKeyContext = (kid: string) => `platform|attestation-key|${kid}`;

/** The active platform attestation key, created on first use. */
export async function platformSigningKey(tx: DbOrTx, ring: KeyRing): Promise<{ kid: string; privatePem: string }> {
  const [existing] = await tx
    .select()
    .from(platformSigningKeys)
    .where(isNull(platformSigningKeys.retiredAt))
    .orderBy(desc(platformSigningKeys.createdAt))
    .limit(1);
  if (existing)
    return {
      kid: existing.kid,
      privatePem: decryptSecret(existing.privateKey, platformKeyContext(existing.kid), ring),
    };
  const key = generateSigningKey();
  await tx.insert(platformSigningKeys).values({
    kid: key.kid,
    publicJwk: key.publicJwk,
    privateKey: encryptSecret(key.privatePem, platformKeyContext(key.kid), ring),
  });
  return { kid: key.kid, privatePem: key.privatePem };
}

/** Retires the active key; the next attestation creates a new one (runbook: rotate-attestation-key). */
export async function rotatePlatformSigningKey(tx: DbOrTx, ring: KeyRing): Promise<string> {
  await tx.update(platformSigningKeys).set({ retiredAt: new Date() }).where(isNull(platformSigningKeys.retiredAt));
  return (await platformSigningKey(tx, ring)).kid;
}

/** Public keys, current and retired, for `/.well-known/aperture/jwks.json`. */
export async function platformJwks(tx: DbOrTx): Promise<{ keys: PublicJwk[] }> {
  const rows = await tx.select({ publicJwk: platformSigningKeys.publicJwk }).from(platformSigningKeys);
  return { keys: rows.map((row) => row.publicJwk) };
}

const SEVERITY_RANK: Record<PostureStatus, number> = { pass: 0, not_applicable: 0, waived: 1, unknown: 2, fail: 3 };
const usd = (value: bigint) => formatUsd(micros(value));

export interface AttestationInput {
  orgId: string;
  from: Date;
  to: Date;
  createdBy: string;
  issuer: AttestationDocument['issuer'];
  apertureVersion: string;
}

/**
 * Builds, signs, and stores an attestation for a period. Activity comes from the ledger and the
 * audit chain (never deleted), plus denials from the request log with a completeness flag.
 */
export async function createAttestation(
  tx: DbOrTx,
  ring: KeyRing,
  input: AttestationInput,
): Promise<{ id: string; document: AttestationDocument; jws: string; kid: string }> {
  const { orgId, from, to } = input;
  const [org] = await tx.select({ name: orgs.name, timezone: orgs.timezone }).from(orgs).where(eq(orgs.id, orgId));
  if (!org) throw new Error('organization not found');
  const now = await dbNow(tx);

  // Posture: results at period end, and the worst status of each check during the period.
  const runs = await tx
    .select()
    .from(postureRuns)
    .where(and(eq(postureRuns.orgId, orgId), gte(postureRuns.ranAt, from), lte(postureRuns.ranAt, to)))
    .orderBy(asc(postureRuns.ranAt));
  const [beforeEnd] =
    runs.length > 0
      ? [runs[runs.length - 1]]
      : await tx
          .select()
          .from(postureRuns)
          .where(and(eq(postureRuns.orgId, orgId), lte(postureRuns.ranAt, to)))
          .orderBy(desc(postureRuns.ranAt))
          .limit(1);
  const endResults = (beforeEnd?.results ?? []) as CheckResult[];
  const worst = new Map<string, PostureStatus>();
  for (const run of runs) {
    for (const result of run.results as CheckResult[]) {
      const previous = worst.get(result.id);
      if (previous === undefined || SEVERITY_RANK[result.status] > SEVERITY_RANK[previous])
        worst.set(result.id, result.status);
    }
  }

  // Activity from the ledger.
  const spend = await tx.execute<{ rail: string; amount: string }>(sql`
    select rail, sum(case when kind = 'refund' then -amount else amount end)::text as amount
    from ledger_entries where org_id = ${orgId}
      and kind in ('capture', 'unheld_capture', 'observed', 'adjustment', 'refund')
      and occurred_at >= ${from.toISOString()} and occurred_at < ${to.toISOString()}
    group by rail`);
  const spendByRail = { gateway: 0n, provider: 0n, card: 0n, x402: 0n };
  for (const row of spend.rows)
    if (row.rail in spendByRail) spendByRail[row.rail as keyof typeof spendByRail] = BigInt(row.amount);

  const [allowed] = (
    await tx.execute<{ count: string }>(sql`
      select count(*) from ledger_entries where org_id = ${orgId} and kind = 'hold' and rail = 'gateway'
        and occurred_at >= ${from.toISOString()} and occurred_at < ${to.toISOString()}`)
  ).rows;
  const denials = await tx.execute<{ outcome: string; count: string }>(sql`
    select outcome, count(*) from gateway_requests where org_id = ${orgId} and outcome like 'denied%'
      and created_at >= ${from.toISOString()} and created_at < ${to.toISOString()} group by outcome`);
  const [settings] = await tx
    .select({ days: orgSettings.requestLogDays })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId));
  const retentionStart = now.getTime() - (settings?.days ?? 90) * 86_400_000;

  const actions = await tx.execute<{ action: string; count: string }>(sql`
    select action, count(*) from audit_events where org_id = ${orgId}
      and occurred_at >= ${from.toISOString()} and occurred_at < ${to.toISOString()}
      and action in ('approval.approved', 'approval.denied', 'mandate.issued', 'subagent.created', 'mandate.revoked',
                     'agents.paused_all', 'principal.paused', 'principal.paused_self')
    group by action`);
  const count = (name: string) => Number(actions.rows.find((row) => row.action === name)?.count ?? 0);
  const [expired] = (
    await tx.execute<{ count: string }>(sql`
      select count(*) from approvals where org_id = ${orgId} and status = 'expired'
        and expires_at >= ${from.toISOString()} and expires_at < ${to.toISOString()}`)
  ).rows;

  const waivers = await tx
    .select()
    .from(postureWaivers)
    .where(
      and(eq(postureWaivers.orgId, orgId), lte(postureWaivers.createdAt, to), gte(postureWaivers.expiresAt, from)),
    );

  // Audit proof for the period: chain range, Merkle root, and anchors.
  const range = await tx.execute<{ first: number | null; last: number | null }>(sql`
    select min(seq)::int as first, max(seq)::int as last from audit_events
    where org_id = ${orgId} and occurred_at >= ${from.toISOString()} and occurred_at < ${to.toISOString()}`);
  const first = range.rows[0]?.first ?? null;
  const last = range.rows[0]?.last ?? null;
  let audit: AttestationDocument['audit'] = {
    events: 0,
    firstSeq: null,
    lastSeq: null,
    prevHash: null,
    lastHash: null,
    merkleRoot: null,
    chainIntact: true,
    brokenAtSeq: null,
    anchors: [],
  };
  if (first !== null && last !== null) {
    const records = await exportAuditEvents(tx, orgId, { fromSeq: first, toSeq: last });
    const prevHash = records[0]?.prevHash ?? GENESIS_HASH;
    const verification = verifyChain(records, { startPrevHash: prevHash, startSeq: first });
    audit = {
      events: records.length,
      firstSeq: first,
      lastSeq: last,
      prevHash,
      lastHash: records[records.length - 1]?.hash ?? null,
      merkleRoot: merkleRoot(records.map((record) => record.hash)),
      chainIntact: verification.ok,
      brokenAtSeq: verification.ok ? null : verification.seq,
      anchors: [],
    };
  }
  const anchors = await tx
    .select()
    .from(auditAnchors)
    .where(and(eq(auditAnchors.orgId, orgId), gte(auditAnchors.createdAt, from), lte(auditAnchors.createdAt, to)))
    .orderBy(asc(auditAnchors.day));
  audit.anchors = anchors.map((a) => ({ day: a.day, root: a.root, network: a.network, signature: a.signature }));

  const coverage = coverageShares(await coverageAmounts(tx, orgId, { from, to }));
  const agents = await tx
    .select({ id: principals.id, name: principals.name, riskTier: principals.riskTier, status: principals.status })
    .from(principals)
    .where(and(eq(principals.orgId, orgId), eq(principals.kind, 'agent'), isNull(principals.systemRole)));

  const id = uuidv7();
  const document: AttestationDocument = {
    type: ATTESTATION_TYPE,
    version: 1,
    id,
    issuer: input.issuer,
    org: { id: orgId, name: org.name },
    period: { from: from.toISOString(), to: to.toISOString(), timezone: org.timezone },
    generatedAt: now.toISOString(),
    apertureVersion: input.apertureVersion,
    posture: {
      catalogueVersion: beforeEnd?.catalogueVersion ?? 0,
      score: beforeEnd?.score ?? 0,
      grade: (beforeEnd?.grade ?? 'F') as AttestationDocument['posture']['grade'],
      results: endResults
        .map((r) => ({ id: r.id, severity: r.severity, status: r.status }))
        .sort(
          (a, b) =>
            POSTURE_SEVERITIES.indexOf(a.severity) - POSTURE_SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id),
        ),
      worstDuringPeriod: [...worst.entries()]
        .map(([checkId, status]) => ({ id: checkId, status }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      runs: runs.length,
    },
    activity: {
      spendByRail: {
        gateway: usd(spendByRail.gateway),
        provider: usd(spendByRail.provider),
        card: usd(spendByRail.card),
        x402: usd(spendByRail.x402),
      },
      decisions: {
        allowed: Number(allowed?.count ?? 0),
        denied: Object.fromEntries(denials.rows.map((row) => [row.outcome, Number(row.count)])),
        requestLogComplete: from.getTime() >= retentionStart,
      },
      approvals: {
        granted: count('approval.approved'),
        denied: count('approval.denied'),
        expired: Number(expired?.count ?? 0),
      },
      mandates: { issued: count('mandate.issued') + count('subagent.created'), revoked: count('mandate.revoked') },
      killSwitchUses: count('agents.paused_all') + count('principal.paused') + count('principal.paused_self'),
      waivers: waivers.map((w) => ({
        checkId: w.checkId,
        subjectId: w.subjectId,
        reason: w.reason,
        expiresAt: w.expiresAt.toISOString(),
      })),
    },
    coverage: coverage.map((share) => ({
      status: share.status,
      amount: usd(share.amount),
      basisPoints: share.basisPoints,
    })),
    audit,
    agents: agents.map((a) => ({ id: a.id, name: a.name, riskTier: a.riskTier, status: a.status })),
    disclaimer: ATTESTATION_DISCLAIMER,
  };

  const key = await platformSigningKey(tx, ring);
  const jws = signJws(document as unknown as Record<string, unknown>, key, ATTESTATION_JWS_TYP);
  await tx.insert(attestations).values({
    id,
    orgId,
    periodFrom: from,
    periodTo: to,
    status: 'ready',
    document: document as unknown as Record<string, unknown>,
    jws,
    kid: key.kid,
    createdBy: input.createdBy,
  });
  return { id, document, jws, kid: key.kid };
}
