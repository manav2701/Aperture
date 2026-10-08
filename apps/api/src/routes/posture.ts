import {
  POSTURE_CATALOGUE,
  coverageShares,
  formatUsd,
  micros,
  postureCheck,
  resultsForTeam,
  toCsv,
  type CheckResult,
} from '@aperture/core';
import { and, coverageAmounts, desc, eq, gt, inventoryRows, isNull, schema, withOrg } from '@aperture/db';
import { runPosture } from '@aperture/jobs';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, notFound } from '../http/errors';
import { reachOf } from '../http/scope';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';

/*
 * Governance posture, waivers, and the AI inventory (plan/phases/phase-11 §11.1–11.3, §11.8).
 */

const MAX_WAIVER_DAYS = 180;
const MANUAL_RUN_GAP_MS = 60_000;
const usd = (value: bigint) => formatUsd(micros(value));

const SubjectSchema = z.object({
  kind: z.string(),
  id: z.string(),
  label: z.string(),
  teamId: z.string().nullable().optional(),
});
const CheckResultSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    area: z.string(),
    status: z.enum(['pass', 'fail', 'unknown', 'not_applicable', 'waived']),
    fixHref: z.string(),
    subjects: z.array(SubjectSchema),
    waivedSubjects: z.array(SubjectSchema),
    detail: z.string().nullable(),
  })
  .openapi('PostureCheckResult');
const RunFields = z.object({
    id: z.uuid(),
    ranAt: Timestamp,
    score: z.number().int(),
    grade: z.string(),
    trigger: z.enum(['scheduled', 'manual', 'attestation']),
    catalogueVersion: z.number().int(),
});
const RunSchema = RunFields.openapi('PostureRun');
const WaiverSchema = z
  .object({
    id: z.uuid(),
    checkId: z.string(),
    subjectId: z.string().nullable(),
    reason: z.string(),
    createdBy: z.string(),
    expiresAt: Timestamp,
    createdAt: Timestamp,
  })
  .openapi('PostureWaiver');
const CoverageSchema = z
  .array(z.object({ status: z.enum(['enforced', 'visible', 'unassigned', 'external']), amount: z.string(), basisPoints: z.number().int() }))
  .openapi('Coverage');
const InventoryRowSchema = z
  .object({
    kind: z.string(),
    id: z.string(),
    name: z.string(),
    owner: z.string().nullable(),
    teamId: z.string().nullable(),
    status: z.enum(['enforced', 'visible', 'unassigned', 'external']),
    lastActivityAt: Timestamp.nullable(),
    spend30d: z.string(),
    detail: z.string().nullable(),
  })
  .openapi('InventoryRow');

type RunRow = typeof schema.postureRuns.$inferSelect;
const runView = (run: RunRow) => ({
  id: run.id,
  ranAt: run.ranAt.toISOString(),
  score: run.score,
  grade: run.grade,
  trigger: run.trigger,
  catalogueVersion: run.catalogueVersion,
});

async function coverageFor(deps: AppDeps, orgId: string) {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const amounts = await withOrg(deps.db, orgId, (tx) => coverageAmounts(tx, orgId, { from, to }));
  return coverageShares(amounts).map((share) => ({ status: share.status, amount: usd(share.amount), basisPoints: share.basisPoints }));
}

export function registerPostureRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'posture.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/posture',
      tags: ['posture'],
      summary: 'The latest posture run, its results, the check catalogue, and active waivers',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            run: RunFields.nullable(),
            results: z.array(CheckResultSchema),
            catalogue: z.array(
              z.object({ id: z.string(), title: z.string(), severity: z.string(), area: z.string(), rationale: z.string(), fixHref: z.string() }),
            ),
            waivers: z.array(WaiverSchema),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const reach = reachOf(c.var.membership, 'posture.read');
      const { run, waivers } = await withOrg(deps.db, orgId, async (tx) => ({
        run: (
          await tx.select().from(schema.postureRuns).where(eq(schema.postureRuns.orgId, orgId)).orderBy(desc(schema.postureRuns.ranAt)).limit(1)
        )[0],
        waivers: await tx
          .select()
          .from(schema.postureWaivers)
          .where(and(eq(schema.postureWaivers.orgId, orgId), isNull(schema.postureWaivers.revokedAt), gt(schema.postureWaivers.expiresAt, new Date())))
          .orderBy(desc(schema.postureWaivers.createdAt)),
      }));
      const results = (run?.results ?? []) as CheckResult[];
      return c.json(
        {
          run: run === undefined ? null : runView(run),
          results: reach.kind === 'team' ? resultsForTeam(results, reach.teamId) : results,
          catalogue: POSTURE_CATALOGUE.map(({ id, title, severity, area, rationale, fixHref }) => ({ id, title, severity, area, rationale, fixHref })),
          waivers: waivers.map((w) => ({
            id: w.id,
            checkId: w.checkId,
            subjectId: w.subjectId,
            reason: w.reason,
            createdBy: w.createdBy,
            expiresAt: w.expiresAt.toISOString(),
            createdAt: w.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'posture.read' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/posture/runs',
      tags: ['posture'],
      summary: 'Run the posture checks now (at most once a minute per org)',
      request: { params: OrgParams },
      responses: { 201: json(RunSchema), 429: json(z.object({ error: z.object({ code: z.string(), message: z.string() }) }), 'Too soon'), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      if (reachOf(c.var.membership, 'posture.read').kind === 'team')
        throw new AppError(403, 'forbidden', 'only org-wide roles can run the posture checks');
      const [last] = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ ranAt: schema.postureRuns.ranAt })
          .from(schema.postureRuns)
          .where(and(eq(schema.postureRuns.orgId, orgId), eq(schema.postureRuns.trigger, 'manual')))
          .orderBy(desc(schema.postureRuns.ranAt))
          .limit(1),
      );
      if (last !== undefined && Date.now() - last.ranAt.getTime() < MANUAL_RUN_GAP_MS)
        throw new AppError(429, 'too_many_runs', 'the posture checks ran less than a minute ago');
      const run = await runPosture(deps.jobs, orgId, 'manual');
      return c.json(
        { id: run.id, ranAt: run.ranAt.toISOString(), score: run.result.score, grade: run.result.grade, trigger: 'manual' as const, catalogueVersion: run.result.catalogueVersion },
        201,
      );
    },
  );

  router.add(
    { permission: 'posture.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/posture/runs',
      tags: ['posture'],
      summary: 'Posture history, newest first',
      request: { params: OrgParams, query: z.object({ limit: z.coerce.number().int().min(1).max(365).default(60) }) },
      responses: { 200: json(z.object({ runs: z.array(RunSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { limit } = c.req.valid('query');
      const runs = await withOrg(deps.db, orgId, (tx) =>
        tx.select().from(schema.postureRuns).where(eq(schema.postureRuns.orgId, orgId)).orderBy(desc(schema.postureRuns.ranAt)).limit(limit),
      );
      return c.json({ runs: runs.map(runView) }, 200);
    },
  );

  router.add(
    { permission: 'posture.waive' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/posture/waivers',
      tags: ['posture'],
      summary: 'Accept a risk: a failing check (or one subject of it) counts as passed until the waiver expires',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            checkId: z.string().min(1).max(100),
            subjectId: z.string().min(1).max(200).nullable().default(null),
            reason: z.string().trim().min(3).max(1000),
            expiresAt: z.iso.datetime({ offset: true }),
          }),
        ),
      },
      responses: { 201: json(WaiverSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      if (postureCheck(body.checkId) === undefined) throw new AppError(400, 'unknown_check', `no posture check ${body.checkId}`);
      const expiresAt = new Date(body.expiresAt);
      const now = Date.now();
      if (expiresAt.getTime() <= now) throw new AppError(400, 'invalid_expiry', 'the waiver must expire in the future');
      if (expiresAt.getTime() > now + MAX_WAIVER_DAYS * 86_400_000 - 60_000)
        throw new AppError(400, 'invalid_expiry', `a waiver can last at most ${String(MAX_WAIVER_DAYS)} days`);
      const waiver = await withOrg(deps.db, orgId, async (tx) => {
        const [row] = await tx
          .insert(schema.postureWaivers)
          .values({ id: uuidv7(), orgId, checkId: body.checkId, subjectId: body.subjectId, reason: body.reason, createdBy: user.id, expiresAt })
          .returning();
        if (!row) throw new Error('insert returned no row');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'posture.waiver.created',
          subject: `posture_waiver:${row.id}`,
          data: { checkId: row.checkId, subjectId: row.subjectId, reason: row.reason, expiresAt: row.expiresAt.toISOString() },
        });
        return row;
      });
      return c.json(
        {
          id: waiver.id,
          checkId: waiver.checkId,
          subjectId: waiver.subjectId,
          reason: waiver.reason,
          createdBy: waiver.createdBy,
          expiresAt: waiver.expiresAt.toISOString(),
          createdAt: waiver.createdAt.toISOString(),
        },
        201,
      );
    },
  );

  router.add(
    { permission: 'posture.waive' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/posture/waivers/{waiverId}',
      tags: ['posture'],
      summary: 'Revoke a waiver; the check counts as failing again if it still fails',
      request: { params: OrgParams.extend({ waiverId: z.uuid().openapi({ param: { name: 'waiverId', in: 'path' } }) }) },
      responses: { 204: { description: 'Revoked' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, waiverId } = c.req.valid('param');
      await withOrg(deps.db, orgId, async (tx) => {
        const [row] = await tx
          .update(schema.postureWaivers)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.postureWaivers.id, waiverId), eq(schema.postureWaivers.orgId, orgId), isNull(schema.postureWaivers.revokedAt)))
          .returning();
        if (!row) throw notFound('waiver');
        await auditByUser(tx, { orgId, userId: user.id, action: 'posture.waiver.revoked', subject: `posture_waiver:${row.id}`, data: { checkId: row.checkId } });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'inventory.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/inventory',
      tags: ['inventory'],
      summary: 'Everything that can spend, with its governance status, and the 30-day coverage figure',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ rows: z.array(InventoryRowSchema), coverage: CoverageSchema })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const reach = reachOf(c.var.membership, 'inventory.read');
      const rows = await withOrg(deps.db, orgId, (tx) => inventoryRows(tx, orgId));
      const visible = reach.kind === 'team' ? rows.filter((row) => row.teamId === reach.teamId) : rows;
      return c.json(
        {
          rows: visible.map((row) => ({ ...row, spend30d: usd(BigInt(row.spend30d)) })),
          // Coverage is an org-wide figure; team leads see their rows but the same headline.
          coverage: await coverageFor(deps, orgId),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'inventory.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/inventory.csv',
      tags: ['inventory'],
      summary: 'The inventory as CSV (formula-safe)',
      request: { params: OrgParams },
      responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } }, ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const reach = reachOf(c.var.membership, 'inventory.read');
      const rows = await withOrg(deps.db, orgId, (tx) => inventoryRows(tx, orgId));
      const visible = reach.kind === 'team' ? rows.filter((row) => row.teamId === reach.teamId) : rows;
      const csv = toCsv(
        ['kind', 'name', 'owner', 'governance', 'spend_30d_usd', 'last_activity', 'detail', 'id'],
        visible.map((r) => [r.kind, r.name, r.owner, r.status, usd(BigInt(r.spend30d)), r.lastActivityAt, r.detail, r.id]),
      );
      return c.body(csv, 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="aperture-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
    },
  );
}
