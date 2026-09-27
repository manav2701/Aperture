import { createHash } from 'node:crypto';
import {
  formatUsd,
  isWithin,
  mandateScopeSchema,
  micros,
  periodKey,
  type MandateScope,
  type MandateScopeInput,
  type Rail,
} from '@aperture/core';
import {
  decryptSecret,
  encryptSecret,
  generateSigningKey,
  signJws,
  type KeyRing,
  type PublicJwk,
} from '@aperture/crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { DbOrTx, Transaction } from './client';
import { budgetHeadroom, dbNow } from './ledger';
import { apiKeys, approvals, budgetUsage, budgets, mandates, orgSigningKeys, orgs, principals } from './schema';

/*
 * Mandates (plan/architecture §10) and approvals (§14). A mandate grants a principal scoped
 * spending authority; delegation to a sub-agent can only narrow it (P2). Approving a request
 * issues a one-shot mandate bound to that request (A3).
 */

export type MandateRow = typeof mandates.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;

export class MandateError extends Error {
  readonly code:
    | 'invalid_scope'
    | 'not_within_parent'
    | 'parent_inactive'
    | 'too_deep'
    | 'not_found'
    | 'exhausted'
    | 'expired'
    | 'revoked'
    | 'separation_of_duties'
    | 'not_pending';
  readonly violations: string[];

  constructor(code: MandateError['code'], message: string, violations: string[] = []) {
    super(message);
    this.name = 'MandateError';
    this.code = code;
    this.violations = violations;
  }
}

/** Sub-agents may delegate to sub-sub-agents, but not without end. */
export const MAX_MANDATE_DEPTH = 3;
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const ONE_SHOT_TTL_MS = 24 * 60 * 60 * 1000;

const keyContext = (orgId: string, kid: string) => `${orgId}|signing-key|${kid}`;

/** The org's active signing key, created on first use. */
async function signingKey(tx: DbOrTx, ring: KeyRing, orgId: string): Promise<{ kid: string; privatePem: string }> {
  const [existing] = await tx
    .select()
    .from(orgSigningKeys)
    .where(and(eq(orgSigningKeys.orgId, orgId), isNull(orgSigningKeys.retiredAt)))
    .orderBy(desc(orgSigningKeys.createdAt))
    .limit(1);
  if (existing)
    return { kid: existing.kid, privatePem: decryptSecret(existing.privateKey, keyContext(orgId, existing.kid), ring) };
  const key = generateSigningKey();
  await tx.insert(orgSigningKeys).values({
    kid: key.kid,
    orgId,
    publicJwk: key.publicJwk,
    privateKey: encryptSecret(key.privatePem, keyContext(orgId, key.kid), ring),
  });
  return { kid: key.kid, privatePem: key.privatePem };
}

/** Public keys (current and retired) for `/.well-known/aperture/orgs/{orgId}/jwks.json`. */
export async function orgJwks(tx: DbOrTx, orgId: string): Promise<{ keys: PublicJwk[] }> {
  const rows = await tx
    .select({ publicJwk: orgSigningKeys.publicJwk })
    .from(orgSigningKeys)
    .where(eq(orgSigningKeys.orgId, orgId));
  return { keys: rows.map((row) => row.publicJwk) };
}

/** Rotation: new mandates are signed with a new key; old ones keep verifying. */
export async function rotateSigningKey(tx: DbOrTx, ring: KeyRing, orgId: string): Promise<string> {
  await tx
    .update(orgSigningKeys)
    .set({ retiredAt: new Date() })
    .where(and(eq(orgSigningKeys.orgId, orgId), isNull(orgSigningKeys.retiredAt)));
  return (await signingKey(tx, ring, orgId)).kid;
}

export function parseScope(stored: unknown): MandateScope {
  const result = mandateScopeSchema.safeParse(stored);
  if (!result.success)
    throw new MandateError(
      'invalid_scope',
      'the mandate scope is invalid',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  return result.data;
}

/** The mandate and its ancestors, nearest first. */
export async function mandateChain(tx: DbOrTx, mandateId: string): Promise<MandateRow[]> {
  const result = await tx.execute<{ id: string }>(sql`
    with recursive chain as (
      select id, parent_id, 0 as depth from mandates where id = ${mandateId}::uuid
      union all
      select m.id, m.parent_id, c.depth + 1 from mandates m join chain c on m.id = c.parent_id where c.depth < 20
    )
    select id from chain order by depth`);
  const ids = result.rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const rows = await tx.select().from(mandates).where(inArray(mandates.id, ids));
  return ids.map((id) => rows.find((row) => row.id === id)).filter((row): row is MandateRow => row !== undefined);
}

/** Every mandate in the chain must be active and inside its validity window (database time, P5). */
export async function assertChainUsable(tx: DbOrTx, chain: readonly MandateRow[]): Promise<void> {
  const now = await dbNow(tx);
  for (const mandate of chain) {
    if (mandate.status !== 'active') throw new MandateError('revoked', 'a mandate in the chain was revoked');
    if (now < mandate.notBefore || now >= mandate.expiresAt)
      throw new MandateError('expired', 'a mandate in the chain is not valid now');
  }
}

/** What is left in one budget node for its current period. */
export async function budgetNodeRemaining(tx: DbOrTx, orgId: string, budgetId: string): Promise<bigint | null> {
  const [node] = await tx
    .select({ limit: budgets.limitAmount, period: budgets.period, timezone: orgs.timezone })
    .from(budgets)
    .innerJoin(orgs, eq(orgs.id, budgets.orgId))
    .where(and(eq(budgets.id, budgetId), eq(budgets.orgId, orgId)));
  if (!node) return null;
  const key = periodKey(await dbNow(tx), node.period, node.timezone);
  const [usage] = await tx
    .select({ held: budgetUsage.held, spent: budgetUsage.spent })
    .from(budgetUsage)
    .where(and(eq(budgetUsage.budgetId, budgetId), eq(budgetUsage.periodKey, key)));
  const left = node.limit - ((usage?.held ?? 0n) + (usage?.spent ?? 0n));
  return left > 0n ? left : 0n;
}

export interface IssueMandateInput {
  orgId: string;
  subjectPrincipalId: string;
  scope: MandateScopeInput;
  parentId?: string | undefined;
  issuerUserId?: string | undefined;
  issuerPrincipalId?: string | undefined;
  approvalId?: string | undefined;
}

/**
 * Issues a signed mandate with its own budget node. With a parent, the child must be within it
 * (isWithin, against what the parent has left right now), the issuer must hold the parent, and
 * the chain may not get deeper than MAX_MANDATE_DEPTH.
 */
export async function issueMandate(db: DbOrTx, ring: KeyRing, input: IssueMandateInput): Promise<MandateRow> {
  return db.transaction(async (tx) => {
    const scope = parseScope(input.scope);
    let parentBudgetId: string | null;
    if (input.parentId !== undefined) {
      const [parent] = await tx
        .select()
        .from(mandates)
        .where(and(eq(mandates.id, input.parentId), eq(mandates.orgId, input.orgId)))
        .for('update');
      if (!parent) throw new MandateError('not_found', 'parent mandate not found');
      if (input.issuerPrincipalId !== undefined && parent.subjectPrincipalId !== input.issuerPrincipalId) {
        throw new MandateError('not_within_parent', 'you can only delegate from your own mandate');
      }
      const chain = await mandateChain(tx, parent.id);
      await assertChainUsable(tx, chain).catch((error: unknown) => {
        throw new MandateError('parent_inactive', (error as Error).message);
      });
      if (chain.length >= MAX_MANDATE_DEPTH)
        throw new MandateError('too_deep', `delegation can't go deeper than ${String(MAX_MANDATE_DEPTH)} levels`);
      const parentScope = parseScope(parent.scope);
      // What the parent can still spend: the tighter of its own budget node and its holder's budgets.
      const headroom = await budgetHeadroom(tx, {
        orgId: input.orgId,
        principalId: parent.subjectPrincipalId,
        rail: scope.rails[0] ?? 'gateway',
      });
      const nodeLeft = parent.budgetId === null ? null : await budgetNodeRemaining(tx, input.orgId, parent.budgetId);
      const remaining = [headroom.remaining, nodeLeft]
        .filter((value): value is bigint => value !== null)
        .reduce<bigint | null>((min, value) => (min === null || value < min ? value : min), null);
      const remainingUses = parent.maxUses === null ? undefined : parent.maxUses - parent.uses;
      const check = isWithin(scope, parentScope, {
        ...(remaining === null ? {} : { remainingBudget: micros(remaining) }),
        ...(remainingUses === undefined ? {} : { remainingUses }),
      });
      if (!check.ok)
        throw new MandateError(
          'not_within_parent',
          'the mandate asks for more than its parent allows',
          check.violations,
        );
      parentBudgetId = parent.budgetId;
    } else {
      // A root mandate's budget sits under its holder's own budget, so spend by sub-agents it
      // delegates to also counts against the agent that delegated.
      const [own] = await tx
        .select({ id: budgets.id })
        .from(budgets)
        .where(
          and(
            eq(budgets.orgId, input.orgId),
            eq(budgets.scope, 'principal'),
            eq(budgets.scopeId, input.subjectPrincipalId),
            isNull(budgets.archivedAt),
          ),
        )
        .orderBy(desc(budgets.createdAt))
        .limit(1);
      parentBudgetId = own?.id ?? null;
    }

    const id = uuidv7();
    const [budget] = await tx
      .insert(budgets)
      .values({
        id: uuidv7(),
        orgId: input.orgId,
        parentId: parentBudgetId,
        name: `Mandate: ${scope.purpose.slice(0, 60)}`,
        scope: 'mandate',
        scopeId: id,
        period: scope.budget.period,
        limitAmount: scope.budget.limit,
        mode: 'hard',
        rails: scope.rails,
      })
      .returning();
    if (!budget) throw new Error('insert returned no row');

    const key = await signingKey(tx, ring, input.orgId);
    const stored = input.scope as unknown as Record<string, unknown>;
    const jws = signJws(
      {
        iss: `aperture:org:${input.orgId}`,
        sub: `aperture:principal:${input.subjectPrincipalId}`,
        jti: id,
        ...(input.parentId === undefined ? {} : { parent: input.parentId }),
        scope: stored,
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.parse(scope.notBefore) / 1000),
        exp: Math.floor(Date.parse(scope.expiresAt) / 1000),
      },
      key,
      'aperture-mandate+jwt',
    );
    const [row] = await tx
      .insert(mandates)
      .values({
        id,
        orgId: input.orgId,
        parentId: input.parentId ?? null,
        issuerUserId: input.issuerUserId ?? null,
        issuerPrincipalId: input.issuerPrincipalId ?? null,
        subjectPrincipalId: input.subjectPrincipalId,
        scope: stored,
        purpose: scope.purpose,
        budgetId: budget.id,
        notBefore: new Date(scope.notBefore),
        expiresAt: new Date(scope.expiresAt),
        maxUses: scope.maxUses ?? null,
        kid: key.kid,
        jws,
        approvalId: input.approvalId ?? null,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  });
}

/**
 * Counts one use, with the mandate row locked (P6: two concurrent requests can't both take the
 * last use). Call it in the same transaction as the reserve it pays for.
 */
export async function consumeMandateUse(tx: Transaction, mandateId: string): Promise<void> {
  const chain = await mandateChain(tx, mandateId);
  await assertChainUsable(tx, chain);
  for (const mandate of chain) {
    const [locked] = await tx.select().from(mandates).where(eq(mandates.id, mandate.id)).for('update');
    if (!locked) throw new MandateError('not_found', 'mandate not found');
    if (locked.maxUses !== null && locked.uses >= locked.maxUses)
      throw new MandateError('exhausted', 'this mandate has no uses left');
    await tx
      .update(mandates)
      .set({ uses: locked.uses + 1 })
      .where(eq(mandates.id, mandate.id));
  }
}

/**
 * Revokes a mandate and everything delegated from it (P4). Sub-agents that only existed through
 * a revoked mandate lose their keys and are revoked too.
 */
export async function revokeMandate(tx: DbOrTx, input: { orgId: string; mandateId: string }): Promise<number> {
  const result = await tx.execute<{ id: string; subject: string; issuer_principal_id: string | null }>(sql`
    with recursive tree as (
      select id from mandates where id = ${input.mandateId}::uuid and org_id = ${input.orgId}::uuid
      union all
      select m.id from mandates m join tree t on m.parent_id = t.id
    )
    update mandates set status = 'revoked', revoked_at = now()
    where id in (select id from tree) and status = 'active'
    returning id, subject_principal_id as subject, issuer_principal_id`);
  const subAgents = result.rows.filter((row) => row.issuer_principal_id !== null).map((row) => row.subject);
  if (subAgents.length > 0) {
    await tx.update(principals).set({ status: 'revoked' }).where(inArray(principals.id, subAgents));
    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(inArray(apiKeys.principalId, subAgents), isNull(apiKeys.revokedAt)));
  }
  return result.rows.length;
}

/** The principal's newest usable standing mandate (not one-shot approval mandates), if any. */
export async function standingMandate(tx: DbOrTx, principalId: string): Promise<MandateRow | undefined> {
  const [row] = await tx
    .select()
    .from(mandates)
    .where(
      and(
        eq(mandates.subjectPrincipalId, principalId),
        eq(mandates.status, 'active'),
        isNull(mandates.approvalId),
        sql`${mandates.notBefore} <= now() and ${mandates.expiresAt} > now()`,
        sql`(${mandates.maxUses} is null or ${mandates.uses} < ${mandates.maxUses})`,
      ),
    )
    .orderBy(desc(mandates.createdAt))
    .limit(1);
  return row;
}

/**
 * Whether the principal was ever given a standing mandate. One that has none usable any more
 * (revoked, expired, used up) is stopped — it doesn't fall back to acting without one (P4).
 */
export async function hasStandingMandate(tx: DbOrTx, principalId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: mandates.id })
    .from(mandates)
    .where(and(eq(mandates.subjectPrincipalId, principalId), isNull(mandates.approvalId)))
    .limit(1);
  return row !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Approvals

export function approvalFingerprint(principalId: string, rail: Rail, resource: string): string {
  return createHash('sha256').update(`${principalId}|${rail}|${resource}`).digest('hex');
}

/** Opens (or reuses a pending) approval for a request that policy sent to a human. */
export async function requestApproval(
  tx: DbOrTx,
  input: {
    orgId: string;
    principalId: string;
    rail: Rail;
    resource: string;
    amount: bigint;
    purpose: string;
    context: Record<string, unknown>;
  },
): Promise<ApprovalRow> {
  const fingerprint = approvalFingerprint(input.principalId, input.rail, input.resource);
  const [pending] = await tx
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.orgId, input.orgId),
        eq(approvals.fingerprint, fingerprint),
        eq(approvals.status, 'pending'),
        sql`${approvals.expiresAt} > now()`,
      ),
    );
  if (pending && pending.amount >= input.amount) return pending;
  const [row] = await tx
    .insert(approvals)
    .values({
      id: uuidv7(),
      orgId: input.orgId,
      requesterPrincipalId: input.principalId,
      fingerprint,
      rail: input.rail,
      resource: input.resource,
      amount: input.amount,
      purpose: input.purpose,
      context: input.context,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

/**
 * Approves or denies. Separation of duties (A1): nobody decides a request they made, or one made
 * by an agent they own. Approval issues a one-shot mandate (A3); it doesn't reserve money (A2).
 */
export async function decideApproval(
  db: DbOrTx,
  ring: KeyRing,
  input: {
    orgId: string;
    approvalId: string;
    deciderUserId: string;
    approve: boolean;
    amount?: bigint | undefined;
    note?: string | undefined;
  },
): Promise<ApprovalRow> {
  return db.transaction(async (tx) => {
    const [approval] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, input.approvalId), eq(approvals.orgId, input.orgId)))
      .for('update');
    if (!approval) throw new MandateError('not_found', 'approval not found');
    if (approval.status !== 'pending' || approval.expiresAt <= (await dbNow(tx))) {
      throw new MandateError(
        'not_pending',
        `this request is ${approval.status === 'pending' ? 'expired' : approval.status}`,
      );
    }
    const [requester] = await tx.select().from(principals).where(eq(principals.id, approval.requesterPrincipalId));
    if (requester?.userId === input.deciderUserId || requester?.ownerUserId === input.deciderUserId) {
      throw new MandateError(
        'separation_of_duties',
        'you can’t decide a request you made or one from an agent you own',
      );
    }

    if (!input.approve) {
      const [denied] = await tx
        .update(approvals)
        .set({
          status: 'denied',
          decidedBy: input.deciderUserId,
          decisionNote: input.note ?? null,
          decidedAt: new Date(),
        })
        .where(eq(approvals.id, approval.id))
        .returning();
      if (!denied) throw new Error('update returned no row');
      return denied;
    }

    const cap = input.amount !== undefined && input.amount < approval.amount ? input.amount : approval.amount;
    const now = await dbNow(tx);
    const [provider, ...modelParts] = approval.resource.split(':');
    const model = modelParts.join(':');
    const scope: MandateScopeInput = {
      rails: [approval.rail],
      ...(approval.rail === 'gateway' && model !== '' ? { models: [model] } : {}),
      ...(approval.rail === 'gateway' && provider ? { providers: [provider] } : {}),
      maxPerAction: formatUsd(micros(cap)),
      budget: { limit: formatUsd(micros(cap)), period: 'none' },
      notBefore: now.toISOString(),
      expiresAt: new Date(now.getTime() + ONE_SHOT_TTL_MS).toISOString(),
      maxUses: 1,
      purpose: `Approved: ${approval.purpose}`.slice(0, 500),
    };
    const mandate = await issueMandate(tx, ring, {
      orgId: input.orgId,
      subjectPrincipalId: approval.requesterPrincipalId,
      scope,
      issuerUserId: input.deciderUserId,
      approvalId: approval.id,
    });
    const [approved] = await tx
      .update(approvals)
      .set({
        status: 'approved',
        decidedBy: input.deciderUserId,
        decisionNote: input.note ?? null,
        approvedAmount: cap,
        mandateId: mandate.id,
        decidedAt: new Date(),
      })
      .where(eq(approvals.id, approval.id))
      .returning();
    if (!approved) throw new Error('update returned no row');
    return approved;
  });
}

/** The approved, unused, unexpired approval a retry names, if it matches this request. */
export async function usableApproval(
  tx: DbOrTx,
  input: { orgId: string; approvalId: string; principalId: string; rail: Rail; resource: string },
): Promise<ApprovalRow | undefined> {
  const [approval] = await tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, input.approvalId), eq(approvals.orgId, input.orgId)));
  if (approval?.status !== 'approved' || approval.mandateId === null) return undefined;
  if (approval.requesterPrincipalId !== input.principalId) return undefined;
  if (approval.fingerprint !== approvalFingerprint(input.principalId, input.rail, input.resource)) return undefined;
  return approval;
}

export async function markApprovalUsed(tx: DbOrTx, approvalId: string): Promise<void> {
  await tx
    .update(approvals)
    .set({ status: 'used' })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, 'approved')));
}

/** Pending approvals past their deadline are denied by default. */
export async function expireApprovals(tx: DbOrTx): Promise<number> {
  const rows = await tx
    .update(approvals)
    .set({ status: 'expired', decidedAt: new Date() })
    .where(and(eq(approvals.status, 'pending'), sql`${approvals.expiresAt} <= now()`))
    .returning({ id: approvals.id });
  return rows.length;
}
