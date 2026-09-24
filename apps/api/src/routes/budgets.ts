import { PERIODS, RAILS, formatUsd, parseUsd, periodKey, type Micros } from '@aperture/core';
import { and, createBudget, eq, inArray, schema, withOrg, type Transaction } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, forbidden, notFound } from '../http/errors';
import { reachOf, type Reach } from '../http/scope';
import { OrgParams, Timestamp, UsdSchema, errorResponses, json, jsonBody } from '../http/schemas';

type BudgetRow = typeof schema.budgets.$inferSelect;

const BudgetSchema = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    name: z.string(),
    scope: z.enum(['org', 'team', 'principal', 'mandate']),
    scopeId: z.uuid().nullable(),
    unit: z.enum(['micros', 'count']),
    period: z.enum(PERIODS),
    mode: z.enum(['hard', 'soft']),
    rails: z.array(z.enum(RAILS)),
    alertThresholds: z.array(z.number().int()),
    /** USD for `micros` budgets, a whole number of actions for `count` budgets. */
    limit: z.string(),
    usage: z.object({ periodKey: z.string(), spent: z.string(), held: z.string() }),
    archived: z.boolean(),
    createdAt: Timestamp,
  })
  .openapi('Budget');

const BudgetParams = OrgParams.extend({ budgetId: z.uuid().openapi({ param: { name: 'budgetId', in: 'path' } }) });
const CountSchema = z.string().regex(/^\d{1,15}$/, 'a whole number of actions');
const Thresholds = z.array(z.number().int().min(1).max(1000)).max(10);

const CreateBudgetBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    parentId: z.uuid().nullable().optional(),
    scope: z.enum(['org', 'team', 'principal']),
    scopeId: z.uuid().nullable().optional(),
    unit: z.enum(['micros', 'count']).default('micros'),
    period: z.enum(PERIODS),
    limit: z.string(),
    mode: z.enum(['hard', 'soft']).default('hard'),
    rails: z.array(z.enum(RAILS)).max(RAILS.length).default([]),
    alertThresholds: Thresholds.default([]),
  })
  .openapi('CreateBudget');

const UpdateBudgetBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    limit: z.string().optional(),
    mode: z.enum(['hard', 'soft']).optional(),
    alertThresholds: Thresholds.optional(),
    archived: z.boolean().optional(),
  })
  .openapi('UpdateBudget');

function parseLimit(unit: 'micros' | 'count', limit: string): bigint {
  if (unit === 'count') {
    if (!CountSchema.safeParse(limit).success) throw new AppError(400, 'invalid_limit', 'limit must be a whole number');
    return BigInt(limit);
  }
  if (!UsdSchema.safeParse(limit).success)
    throw new AppError(400, 'invalid_limit', 'limit must be a USD amount such as "250.00"');
  return parseUsd(limit);
}

const formatAmount = (unit: 'micros' | 'count', amount: bigint) =>
  unit === 'count' ? amount.toString() : formatUsd(amount as Micros);

/** Every budget id at or below the budgets of `teamId`, i.e. what a team lead may manage. */
function teamSubtree(all: readonly BudgetRow[], teamId: string): Set<string> {
  const inside = new Set(all.filter((b) => b.scope === 'team' && b.scopeId === teamId).map((b) => b.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const budget of all) {
      if (budget.parentId !== null && inside.has(budget.parentId) && !inside.has(budget.id)) {
        inside.add(budget.id);
        grew = true;
      }
    }
  }
  return inside;
}

async function loadBudgets(tx: Transaction, orgId: string) {
  const [org] = await tx.select({ timezone: schema.orgs.timezone }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  if (!org) throw notFound('organization');
  const rows = await tx
    .select()
    .from(schema.budgets)
    .where(eq(schema.budgets.orgId, orgId))
    .orderBy(schema.budgets.createdAt);
  return { rows, timezone: org.timezone };
}

async function present(tx: Transaction, rows: readonly BudgetRow[], timezone: string) {
  if (rows.length === 0) return [];
  const now = new Date();
  const keys = new Map(rows.map((b) => [b.id, periodKey(now, b.period, timezone)]));
  const usage = await tx
    .select()
    .from(schema.budgetUsage)
    .where(
      inArray(
        schema.budgetUsage.budgetId,
        rows.map((b) => b.id),
      ),
    );
  const current = new Map(usage.filter((u) => keys.get(u.budgetId) === u.periodKey).map((u) => [u.budgetId, u]));
  return rows.map((b) => {
    const row = current.get(b.id);
    return {
      id: b.id,
      parentId: b.parentId,
      name: b.name,
      scope: b.scope,
      scopeId: b.scopeId,
      unit: b.unit,
      period: b.period,
      mode: b.mode,
      rails: b.rails as (typeof RAILS)[number][],
      alertThresholds: b.alertThresholds,
      limit: formatAmount(b.unit, b.limitAmount),
      usage: {
        periodKey: keys.get(b.id) ?? '',
        spent: formatAmount(b.unit, row?.spent ?? 0n),
        held: formatAmount(b.unit, row?.held ?? 0n),
      },
      archived: b.archivedAt !== null,
      createdAt: b.createdAt.toISOString(),
    };
  });
}

function assertManageable(reach: Reach, all: readonly BudgetRow[], budgetId: string) {
  if (reach.kind === 'all') return;
  if (!teamSubtree(all, reach.teamId).has(budgetId)) throw forbidden('you can only manage budgets inside your team');
}

async function assertScopeTarget(
  tx: Transaction,
  orgId: string,
  scope: 'org' | 'team' | 'principal',
  scopeId: string | null,
) {
  if (scope === 'org') {
    if (scopeId !== null && scopeId !== orgId)
      throw new AppError(400, 'invalid_scope', 'an org budget belongs to the org itself');
    return;
  }
  if (scopeId === null) throw new AppError(400, 'invalid_scope', `a ${scope} budget needs a scopeId`);
  const table = scope === 'team' ? schema.teams : schema.principals;
  const [target] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, scopeId), eq(table.orgId, orgId)));
  if (!target) throw new AppError(400, 'invalid_scope', `that ${scope} does not exist in this organization`);
}

export function registerBudgetRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'budgets.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/budgets',
      tags: ['budgets'],
      summary: 'Every budget with its usage in the current period (the web app builds the tree from parentId)',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ budgets: z.array(BudgetSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const budgets = await withOrg(deps.db, orgId, async (tx) => {
        const { rows, timezone } = await loadBudgets(tx, orgId);
        return present(tx, rows, timezone);
      });
      return c.json({ budgets }, 200);
    },
  );

  router.add(
    { permission: 'budgets.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/budgets',
      tags: ['budgets'],
      request: { params: OrgParams, ...jsonBody(CreateBudgetBody) },
      responses: { 201: json(BudgetSchema, 'Created'), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const reach = reachOf(c.var.membership, 'budgets.manage');
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const limit = parseLimit(body.unit, body.limit);
      const parentId = body.parentId ?? null;
      const scopeId = body.scope === 'org' ? orgId : (body.scopeId ?? null);

      const budget = await withOrg(deps.db, orgId, async (tx) => {
        const { rows, timezone } = await loadBudgets(tx, orgId);
        if (reach.kind === 'team') {
          if (parentId === null) throw forbidden('team leads create budgets under their team’s budget');
          assertManageable(reach, rows, parentId);
        }
        if (parentId !== null) {
          const parent = rows.find((b) => b.id === parentId);
          if (!parent) throw new AppError(400, 'invalid_parent', 'parent budget not found');
          if (parent.archivedAt !== null) throw new AppError(400, 'invalid_parent', 'parent budget is archived');
        }
        await assertScopeTarget(tx, orgId, body.scope, scopeId);
        const created = await createBudget(tx, {
          orgId,
          name: body.name,
          parentId: parentId ?? undefined,
          scope: body.scope,
          scopeId: scopeId ?? undefined,
          unit: body.unit,
          period: body.period,
          limit,
          mode: body.mode,
          rails: body.rails,
          alertThresholds: body.alertThresholds,
        });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'budget.created',
          subject: `budget:${created.id}`,
          data: {
            name: body.name,
            scope: body.scope,
            period: body.period,
            unit: body.unit,
            limit: body.limit,
            mode: body.mode,
          },
        });
        const [presented] = await present(tx, [created], timezone);
        if (!presented) throw new Error('budget vanished');
        return presented;
      });
      return c.json(budget, 201);
    },
  );

  router.add(
    { permission: 'budgets.manage' },
    createRoute({
      method: 'patch',
      path: '/api/v1/orgs/{orgId}/budgets/{budgetId}',
      tags: ['budgets'],
      summary: 'Rename, change the limit or mode, set alerts, or archive',
      request: { params: BudgetParams, ...jsonBody(UpdateBudgetBody) },
      responses: { 200: json(BudgetSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const reach = reachOf(c.var.membership, 'budgets.manage');
      const { orgId, budgetId } = c.req.valid('param');
      const body = c.req.valid('json');

      const budget = await withOrg(deps.db, orgId, async (tx) => {
        const { rows, timezone } = await loadBudgets(tx, orgId);
        const current = rows.find((b) => b.id === budgetId);
        if (!current) throw notFound('budget');
        assertManageable(reach, rows, budgetId);
        // A team lead may tune budgets below the team's own budget, not the team budget itself.
        if (
          reach.kind === 'team' &&
          (current.parentId === null || !teamSubtree(rows, reach.teamId).has(current.parentId))
        ) {
          throw forbidden('the team budget is set by finance or an admin');
        }
        if (body.archived === true && rows.some((b) => b.parentId === budgetId && b.archivedAt === null)) {
          throw new AppError(409, 'budget_has_children', 'archive the budgets below this one first');
        }
        const limit = body.limit === undefined ? undefined : parseLimit(current.unit, body.limit);
        const [updated] = await tx
          .update(schema.budgets)
          .set({
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(limit === undefined ? {} : { limitAmount: limit }),
            ...(body.mode === undefined ? {} : { mode: body.mode }),
            ...(body.alertThresholds === undefined ? {} : { alertThresholds: body.alertThresholds }),
            ...(body.archived === undefined ? {} : { archivedAt: body.archived ? new Date() : null }),
          })
          .where(and(eq(schema.budgets.id, budgetId), eq(schema.budgets.orgId, orgId)))
          .returning();
        if (!updated) throw notFound('budget');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'budget.updated',
          subject: `budget:${budgetId}`,
          data: {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.limit === undefined
              ? {}
              : { limit: body.limit, previousLimit: formatAmount(current.unit, current.limitAmount) }),
            ...(body.mode === undefined ? {} : { mode: body.mode }),
            ...(body.alertThresholds === undefined ? {} : { alertThresholds: body.alertThresholds }),
            ...(body.archived === undefined ? {} : { archived: body.archived }),
          },
        });
        const [presented] = await present(tx, [updated], timezone);
        if (!presented) throw new Error('budget vanished');
        return presented;
      });
      return c.json(budget, 200);
    },
  );
}
