import { createHash, randomBytes } from 'node:crypto';
import { formatShare, type AttestationDocument } from '@aperture/core';
import { and, appendAuditEvent, createAttestation, desc, eq, isNull, platformJwks, schema, sql, withOrg, withSystem } from '@aperture/db';
import { runPosture } from '@aperture/jobs';
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps, AppEnv } from '../http/context';
import { AppError, errorBody, notFound } from '../http/errors';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';
import { renderPdf, type PdfLine } from '../pdf';

/*
 * Signed governance attestations (plan/phases/phase-11 §11.5). The JSON is the record of truth,
 * signed by the platform (or instance) key; the PDF is rendered from it on download. Share links
 * carry an unguessable token stored only as a SHA-256, expire within 90 days, and can be revoked.
 */

const MAX_PERIOD_DAYS = 366;
const MAX_SHARE_DAYS = 90;
const SHARE_VIEWS_PER_MINUTE = 30;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

const AttestationSummary = z
  .object({
    id: z.uuid(),
    periodFrom: Timestamp,
    periodTo: Timestamp,
    status: z.enum(['ready', 'failed']),
    score: z.number().int().nullable(),
    grade: z.string().nullable(),
    kid: z.string().nullable(),
    createdAt: Timestamp,
  })
  .openapi('AttestationSummary');
const SignedAttestation = z
  .object({ document: z.record(z.string(), z.unknown()), jws: z.string() })
  .openapi('SignedAttestation');
const ShareSchema = z
  .object({ id: z.uuid(), expiresAt: Timestamp, revokedAt: Timestamp.nullable(), views: z.number().int(), createdAt: Timestamp })
  .openapi('AttestationShare');
const AttestationParams = OrgParams.extend({ attestationId: z.uuid().openapi({ param: { name: 'attestationId', in: 'path' } }) });

type AttestationRow = typeof schema.attestations.$inferSelect;
const summary = (row: AttestationRow) => {
  const posture = (row.document as { posture?: { score?: number; grade?: string } } | null)?.posture;
  return {
    id: row.id,
    periodFrom: row.periodFrom.toISOString(),
    periodTo: row.periodTo.toISOString(),
    status: row.status,
    score: posture?.score ?? null,
    grade: posture?.grade ?? null,
    kid: row.kid,
    createdAt: row.createdAt.toISOString(),
  };
};

/** The PDF a person reads: every number comes from the signed document. */
export function attestationPdf(document: AttestationDocument, verifyUrl: string): Uint8Array {
  const lines: PdfLine[] = [
    { text: 'Governance attestation', size: 20, bold: true },
    { text: document.org.name, size: 13, gap: 4 },
    { text: `Period: ${document.period.from.slice(0, 10)} to ${document.period.to.slice(0, 10)} (${document.period.timezone})`, gap: 8 },
    { text: `Issued ${document.generatedAt} by ${document.issuer.kind === 'aperture_cloud' ? 'Aperture Cloud' : `the operator of ${document.issuer.instance} (self-hosted)`}` },
    { text: `Attestation ${document.id}` },
    { text: 'Posture', size: 13, bold: true, gap: 14 },
    { text: `Score ${String(document.posture.score)} / 100 (grade ${document.posture.grade}), catalogue v${String(document.posture.catalogueVersion)}, ${String(document.posture.runs)} run(s) in the period` },
    ...document.posture.results
      .filter((r) => r.status !== 'pass' && r.status !== 'not_applicable')
      .map((r) => ({ text: `${r.status.toUpperCase()}  ${r.severity}  ${r.id}`, indent: 12 })),
    { text: 'Spend by rail (USD)', size: 13, bold: true, gap: 14 },
    ...Object.entries(document.activity.spendByRail).map(([rail, amount]) => ({ text: `${rail}: $${amount}`, indent: 12 })),
    { text: 'Governance coverage', size: 13, bold: true, gap: 14 },
    ...document.coverage.map((share) => ({ text: `${share.status}: ${formatShare(share.basisPoints)} ($${share.amount})`, indent: 12 })),
    { text: 'Decisions and controls', size: 13, bold: true, gap: 14 },
    { text: `Allowed requests: ${String(document.activity.decisions.allowed)}`, indent: 12 },
    ...Object.entries(document.activity.decisions.denied).map(([reason, n]) => ({ text: `${reason}: ${String(n)}`, indent: 12 })),
    ...(document.activity.decisions.requestLogComplete
      ? []
      : [{ text: 'Denials before the request-log retention window are not included.', indent: 12 }]),
    { text: `Approvals: ${String(document.activity.approvals.granted)} granted, ${String(document.activity.approvals.denied)} denied, ${String(document.activity.approvals.expired)} expired`, indent: 12 },
    { text: `Mandates: ${String(document.activity.mandates.issued)} issued, ${String(document.activity.mandates.revoked)} revoked; kill switch used ${String(document.activity.killSwitchUses)} time(s)`, indent: 12 },
    ...document.activity.waivers.map((w) => ({ text: `Waiver: ${w.checkId}${w.subjectId === null ? '' : ` (${w.subjectId})`} until ${w.expiresAt.slice(0, 10)}: ${w.reason}`, indent: 12 })),
    { text: 'Audit proof', size: 13, bold: true, gap: 14 },
    { text: `${String(document.audit.events)} events, seq ${String(document.audit.firstSeq ?? '-')} to ${String(document.audit.lastSeq ?? '-')}; chain ${document.audit.chainIntact ? 'intact' : `BROKEN at seq ${String(document.audit.brokenAtSeq)}`}`, indent: 12 },
    { text: `Merkle root: ${document.audit.merkleRoot ?? '-'}`, indent: 12, size: 8 },
    { text: `Last hash: ${document.audit.lastHash ?? '-'}`, indent: 12, size: 8 },
    ...document.audit.anchors.map((a) => ({ text: `Anchor ${a.day} on ${a.network}: ${a.signature}`, indent: 12, size: 8 })),
    { text: 'Verify', size: 13, bold: true, gap: 14 },
    { text: `Drop the JSON file into ${verifyUrl}, or run: pnpm attestation-verify attestation.json --audit audit.jsonl`, indent: 12 },
    { text: `Signing keys: ${document.issuer.jwksUrl}`, indent: 12, size: 8 },
    { text: document.disclaimer, gap: 18, size: 9 },
  ];
  return renderPdf({ title: `Aperture attestation ${document.id}`, lines, footer: `Attestation ${document.id}` });
}

/** A tiny fixed-window limiter for the public share endpoint (per client address). */
function shareLimiter() {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const window = windows.get(key);
    if (window === undefined || now - window.start > 60_000) {
      if (windows.size > 10_000) windows.clear();
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= SHARE_VIEWS_PER_MINUTE;
  };
}

export function registerAttestationRoutes(router: Router, deps: AppDeps): void {
  const issuer = (): AttestationDocument['issuer'] => ({
    kind: deps.attestationIssuer?.kind ?? 'self_hosted',
    instance: deps.attestationIssuer?.instance ?? new URL(deps.webOrigin).host,
    jwksUrl: `${deps.webOrigin}/api/v1/public/jwks.json`,
  });

  router.add(
    { permission: 'attestation.create' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/attestations',
      tags: ['attestations'],
      summary: 'Build and sign an attestation for a period (runs the posture checks first when the period ends now)',
      request: { params: OrgParams, ...jsonBody(z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })) },
      responses: { 201: json(AttestationSummary), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const from = new Date(body.from);
      const to = new Date(body.to);
      const now = Date.now();
      if (from >= to) throw new AppError(400, 'invalid_range', '"from" must be before "to"');
      if (to.getTime() > now + 86_400_000) throw new AppError(400, 'invalid_range', 'the period can’t end in the future');
      if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * 86_400_000)
        throw new AppError(400, 'invalid_range', `a period can be at most ${String(MAX_PERIOD_DAYS)} days`);
      if (to.getTime() >= now - 86_400_000) await runPosture(deps.jobs, orgId, 'attestation');
      const created = await withOrg(deps.db, orgId, async (tx) => {
        const result = await createAttestation(tx, deps.ring, {
          orgId,
          from,
          to: new Date(Math.min(to.getTime(), now)),
          createdBy: user.id,
          issuer: issuer(),
          apertureVersion: deps.apertureVersion ?? 'dev',
        });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'attestation.created',
          subject: `attestation:${result.id}`,
          data: { from: from.toISOString(), to: to.toISOString(), kid: result.kid },
        });
        const [row] = await tx.select().from(schema.attestations).where(eq(schema.attestations.id, result.id));
        if (!row) throw new Error('attestation missing after insert');
        return row;
      });
      return c.json(summary(created), 201);
    },
  );

  router.add(
    { permission: 'attestation.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/attestations',
      tags: ['attestations'],
      request: { params: OrgParams },
      responses: { 200: json(z.object({ attestations: z.array(AttestationSummary) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx.select().from(schema.attestations).where(eq(schema.attestations.orgId, orgId)).orderBy(desc(schema.attestations.createdAt)).limit(200),
      );
      return c.json({ attestations: rows.map(summary) }, 200);
    },
  );

  const loadReady = async (orgId: string, attestationId: string) => {
    const [row] = await withOrg(deps.db, orgId, (tx) =>
      tx
        .select()
        .from(schema.attestations)
        .where(and(eq(schema.attestations.id, attestationId), eq(schema.attestations.orgId, orgId))),
    );
    if (row?.status !== 'ready' || row.jws === null || row.document === null) throw notFound('attestation');
    return { row, document: row.document as unknown as AttestationDocument, jws: row.jws };
  };

  router.add(
    { permission: 'attestation.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/attestations/{attestationId}',
      tags: ['attestations'],
      summary: 'The signed attestation (JSON document and compact JWS)',
      request: { params: AttestationParams },
      responses: { 200: json(SignedAttestation), ...errorResponses },
    }),
    async (c) => {
      const { orgId, attestationId } = c.req.valid('param');
      const { document, jws } = await loadReady(orgId, attestationId);
      return c.json({ document: document as unknown as Record<string, unknown>, jws }, 200, {
        'content-disposition': `attachment; filename="aperture-attestation-${attestationId}.json"`,
      });
    },
  );

  router.add(
    { permission: 'attestation.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/attestations/{attestationId}/pdf',
      tags: ['attestations'],
      summary: 'The attestation rendered as PDF',
      request: { params: AttestationParams },
      responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.string() } } }, ...errorResponses },
    }),
    async (c) => {
      const { orgId, attestationId } = c.req.valid('param');
      const { document } = await loadReady(orgId, attestationId);
      const pdf = attestationPdf(document, `${deps.webOrigin}/verify`);
      return c.body(pdf.buffer as ArrayBuffer, 200, {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="aperture-attestation-${attestationId}.pdf"`,
      });
    },
  );

  router.add(
    { permission: 'attestation.create' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/attestations/{attestationId}/shares',
      tags: ['attestations'],
      summary: 'Create a share link (shown once; expires within 90 days; revocable)',
      request: { params: AttestationParams, ...jsonBody(z.object({ expiresInDays: z.number().int().min(1).max(MAX_SHARE_DAYS) })) },
      responses: { 201: json(ShareSchema.extend({ url: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, attestationId } = c.req.valid('param');
      const { expiresInDays } = c.req.valid('json');
      await loadReady(orgId, attestationId);
      const token = randomBytes(32).toString('base64url');
      const share = await withOrg(deps.db, orgId, async (tx) => {
        const [row] = await tx
          .insert(schema.attestationShares)
          .values({
            id: uuidv7(),
            orgId,
            attestationId,
            tokenHash: tokenHash(token),
            // A minute short of the limit so the database check (≤ 90 days) always holds.
            expiresAt: new Date(Date.now() + expiresInDays * 86_400_000 - 60_000),
            createdBy: user.id,
          })
          .returning();
        if (!row) throw new Error('insert returned no row');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'attestation.share.created',
          subject: `attestation:${attestationId}`,
          data: { shareId: row.id, expiresAt: row.expiresAt.toISOString() },
        });
        return row;
      });
      return c.json(
        {
          id: share.id,
          expiresAt: share.expiresAt.toISOString(),
          revokedAt: null,
          views: 0,
          createdAt: share.createdAt.toISOString(),
          url: `${deps.webOrigin}/a/${token}`,
        },
        201,
      );
    },
  );

  router.add(
    { permission: 'attestation.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/attestations/{attestationId}/shares',
      tags: ['attestations'],
      request: { params: AttestationParams },
      responses: { 200: json(z.object({ shares: z.array(ShareSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId, attestationId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.attestationShares)
          .where(and(eq(schema.attestationShares.orgId, orgId), eq(schema.attestationShares.attestationId, attestationId)))
          .orderBy(desc(schema.attestationShares.createdAt)),
      );
      return c.json(
        {
          shares: rows.map((s) => ({
            id: s.id,
            expiresAt: s.expiresAt.toISOString(),
            revokedAt: s.revokedAt?.toISOString() ?? null,
            views: s.views,
            createdAt: s.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'attestation.create' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/attestations/{attestationId}/shares/{shareId}',
      tags: ['attestations'],
      request: { params: AttestationParams.extend({ shareId: z.uuid().openapi({ param: { name: 'shareId', in: 'path' } }) }) },
      responses: { 204: { description: 'Revoked' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, attestationId, shareId } = c.req.valid('param');
      await withOrg(deps.db, orgId, async (tx) => {
        const [row] = await tx
          .update(schema.attestationShares)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.attestationShares.id, shareId),
              eq(schema.attestationShares.attestationId, attestationId),
              isNull(schema.attestationShares.revokedAt),
            ),
          )
          .returning();
        if (!row) throw notFound('share link');
        await auditByUser(tx, { orgId, userId: user.id, action: 'attestation.share.revoked', subject: `attestation:${attestationId}`, data: { shareId } });
      });
      return c.body(null, 204);
    },
  );

  const allowView = shareLimiter();
  router.add(
    'public',
    createRoute({
      method: 'get',
      path: '/api/v1/public/attestations/{token}',
      tags: ['attestations'],
      summary: 'A shared attestation (token from a share link; rate-limited and audited)',
      request: { params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).openapi({ param: { name: 'token', in: 'path' } }) }) },
      responses: { 200: json(SignedAttestation), 429: json(z.object({ error: z.object({ code: z.string(), message: z.string() }) }), 'Too many requests'), ...errorResponses },
    }),
    async (c) => {
      const client = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
      if (!allowView(client)) return c.json(errorBody('rate_limited', 'too many requests, try again in a minute'), 429);
      const { token } = c.req.valid('param');
      const share = await withSystem(deps.db, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.attestationShares)
          .where(and(eq(schema.attestationShares.tokenHash, tokenHash(token)), isNull(schema.attestationShares.revokedAt)));
        if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
        await tx
          .update(schema.attestationShares)
          .set({ views: sql`${schema.attestationShares.views} + 1`, lastViewedAt: new Date() })
          .where(eq(schema.attestationShares.id, row.id));
        return row;
      });
      if (share === undefined) throw notFound('shared attestation');
      const { document, jws } = await loadReady(share.orgId, share.attestationId);
      await withOrg(deps.db, share.orgId, (tx) =>
        appendAuditEvent(tx, share.orgId, {
          actor: 'public:share-link',
          action: 'attestation.share.viewed',
          subject: `attestation:${share.attestationId}`,
          data: { shareId: share.id },
        }),
      );
      return c.json({ document: document as unknown as Record<string, unknown>, jws }, 200);
    },
  );

  router.add(
    'public',
    createRoute({
      method: 'get',
      path: '/api/v1/public/jwks.json',
      tags: ['attestations'],
      summary: 'Public keys that sign attestations and agent cards (current and retired)',
      responses: { 200: json(z.object({ keys: z.array(z.record(z.string(), z.unknown())) })) },
    }),
    async (c) => {
      const jwks = await platformJwks(deps.db);
      return c.json({ keys: jwks.keys as unknown as Record<string, unknown>[] }, 200, { 'cache-control': 'public, max-age=300' });
    },
  );
}

/** The same keys at the well-known path, for verifiers that don't know Aperture's API. */
export function registerPlatformJwks(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  app.get('/.well-known/aperture/jwks.json', async (c) => {
    const jwks = await platformJwks(deps.db);
    c.header('cache-control', 'public, max-age=300');
    return c.json(jwks);
  });
}
