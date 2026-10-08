import { DATA_CLASSES, formatUsd, micros, policyDocumentSchema, type CheckResult } from '@aperture/core';
import { signJws } from '@aperture/crypto';
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  or,
  platformSigningKey,
  principalPolicyContext,
  schema,
  sql,
  withOrg,
  type Transaction,
} from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, forbidden, notFound } from '../http/errors';
import { reachOf } from '../http/scope';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';

/*
 * Agent cards (plan/phases/phase-11 §11.7): everything about one agent on one page, built only
 * from existing tables plus the three declared fields. The card never contains secrets, key
 * hashes, or anyone's email address.
 */

const usd = (value: bigint) => formatUsd(micros(value));
const AGENT_CARD_TYP = 'aperture-agent-card+jws';
const PrincipalParams = OrgParams.extend({
  principalId: z.uuid().openapi({ param: { name: 'principalId', in: 'path' } }),
});
const SPEND_KINDS = sql`('capture', 'unheld_capture', 'observed', 'adjustment', 'refund')`;
const signed = sql`case when e.kind = 'refund' then -e.amount else e.amount end`;

const AgentCardSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(['active', 'paused', 'revoked']),
    team: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    owner: z.object({ id: z.string(), name: z.string(), isMember: z.boolean() }).nullable(),
    parent: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    createdAt: Timestamp,
    declared: z.object({
      purpose: z.string().nullable(),
      dataClasses: z.array(z.string()),
      riskTier: z.enum(['low', 'medium', 'high']).nullable(),
    }),
    governance: z.enum(['enforced', 'visible', 'unassigned']),
    budgets: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        scope: z.string(),
        mode: z.string(),
        period: z.string(),
        limit: z.string(),
        spent: z.string(),
        held: z.string(),
      }),
    ),
    rules: z.array(z.object({ level: z.string(), type: z.string(), id: z.string() })),
    mandates: z.array(
      z.object({
        id: z.uuid(),
        purpose: z.string(),
        expiresAt: Timestamp,
        parentId: z.uuid().nullable(),
        uses: z.number().int(),
        maxUses: z.number().int().nullable(),
      }),
    ),
    subAgents: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.string() })),
    means: z.object({
      keys: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          prefix: z.string(),
          lastUsedAt: Timestamp.nullable(),
          expiresAt: Timestamp.nullable(),
        }),
      ),
      providerKeys: z.array(
        z.object({ id: z.uuid(), name: z.string(), provider: z.string(), hint: z.string().nullable() }),
      ),
      cards: z.array(z.object({ id: z.uuid(), kind: z.string(), last4: z.string().nullable(), status: z.string() })),
      x402Accounts: z.array(z.object({ id: z.uuid(), network: z.string(), status: z.string() })),
    }),
    activity: z.object({
      spendByRail: z.record(z.string(), z.string()),
      spendByModel: z.array(z.object({ model: z.string(), amount: z.string() })),
      outcomes: z.record(z.string(), z.number().int()),
      approvals: z.object({ asked: z.number().int(), granted: z.number().int(), denied: z.number().int() }),
      killSwitchEvents: z.number().int(),
      lastActivityAt: Timestamp.nullable(),
    }),
    recentAudit: z.array(
      z.object({ seq: z.number().int(), occurredAt: Timestamp, actor: z.string(), action: z.string() }),
    ),
    posture: z.array(z.object({ id: z.string(), title: z.string(), severity: z.string(), status: z.string() })),
    generatedAt: Timestamp,
  })
  .openapi('AgentCard');
type AgentCard = z.infer<typeof AgentCardSchema>;

async function buildCard(tx: Transaction, orgId: string, principalId: string): Promise<AgentCard> {
  const [agent] = await tx
    .select()
    .from(schema.principals)
    .where(
      and(
        eq(schema.principals.id, principalId),
        eq(schema.principals.orgId, orgId),
        eq(schema.principals.kind, 'agent'),
        isNull(schema.principals.systemRole),
      ),
    );
  if (!agent) throw notFound('agent');
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [team] =
    agent.teamId === null
      ? []
      : await tx
          .select({ id: schema.teams.id, name: schema.teams.name })
          .from(schema.teams)
          .where(eq(schema.teams.id, agent.teamId));
  const [owner] =
    agent.ownerUserId === null
      ? []
      : await tx
          .select({ id: schema.users.id, name: schema.users.name, memberId: schema.members.id })
          .from(schema.users)
          .leftJoin(schema.members, and(eq(schema.members.userId, schema.users.id), eq(schema.members.orgId, orgId)))
          .where(eq(schema.users.id, agent.ownerUserId));
  const [parent] =
    agent.parentPrincipalId === null
      ? []
      : await tx
          .select({ id: schema.principals.id, name: schema.principals.name })
          .from(schema.principals)
          .where(eq(schema.principals.id, agent.parentPrincipalId));

  const budgets = await tx.execute<{
    id: string;
    name: string;
    scope: string;
    mode: string;
    period: string;
    limit_amount: string;
    spent: string;
    held: string;
  }>(sql`
    select b.id, b.name, b.scope, b.mode, b.period, b.limit_amount::text,
           coalesce(sum(u.spent), 0)::text as spent, coalesce(sum(u.held), 0)::text as held
    from budgets b left join budget_usage u on u.budget_id = b.id
    where b.org_id = ${orgId} and b.archived_at is null and b.unit = 'micros'
      and ((b.scope = 'principal' and b.scope_id = ${principalId})
        or (b.scope = 'team' and b.scope_id = ${agent.teamId})
        or b.scope = 'org'
        or b.id in (select budget_id from mandates where subject_principal_id = ${principalId} and status = 'active' and budget_id is not null))
    group by b.id order by case b.scope when 'principal' then 0 when 'mandate' then 1 when 'team' then 2 else 3 end`);

  const context = await principalPolicyContext(tx, orgId, principalId);
  const rules = context.layers.flatMap((layer) => {
    const parsed = policyDocumentSchema.safeParse(layer.document);
    return parsed.success
      ? parsed.data.rules.map((rule) => ({ level: layer.level, type: rule.type, id: rule.id }))
      : [];
  });

  const mandates = await tx
    .select()
    .from(schema.mandates)
    .where(
      and(
        eq(schema.mandates.subjectPrincipalId, principalId),
        eq(schema.mandates.status, 'active'),
        gt(schema.mandates.expiresAt, new Date()),
      ),
    );
  const subAgents = await tx
    .select({ id: schema.principals.id, name: schema.principals.name, status: schema.principals.status })
    .from(schema.principals)
    .where(eq(schema.principals.parentPrincipalId, principalId));
  const keys = await tx
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      prefix: schema.apiKeys.prefix,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      expiresAt: schema.apiKeys.expiresAt,
    })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.principalId, principalId), isNull(schema.apiKeys.revokedAt)));
  const providerKeys = await tx
    .select({
      id: schema.credentials.id,
      name: schema.credentials.name,
      hint: schema.credentials.hint,
      provider: schema.connections.provider,
    })
    .from(schema.credentials)
    .innerJoin(schema.connections, eq(schema.connections.id, schema.credentials.connectionId))
    .where(and(eq(schema.credentials.principalId, principalId), sql`${schema.credentials.status} <> 'revoked'`));
  const cards = await tx
    .select({ id: schema.cards.id, kind: schema.cards.kind, last4: schema.cards.last4, status: schema.cards.status })
    .from(schema.cards)
    .where(and(eq(schema.cards.principalId, principalId), sql`${schema.cards.status} <> 'canceled'`));
  const x402 = await tx
    .select({ id: schema.x402Accounts.id, network: schema.x402Accounts.network, status: schema.x402Accounts.status })
    .from(schema.x402Accounts)
    .where(and(eq(schema.x402Accounts.principalId, principalId), sql`${schema.x402Accounts.status} <> 'revoked'`));

  const byRail = await tx.execute<{ rail: string; amount: string }>(sql`
    select e.rail, sum(${signed})::text as amount from ledger_entries e
    where e.principal_id = ${principalId} and e.kind in ${SPEND_KINDS} and e.occurred_at >= ${since.toISOString()} group by 1`);
  const byModel = await tx.execute<{ model: string; amount: string }>(sql`
    select coalesce(e.meta->>'model', split_part(e.resource, ':', 2)) as model, sum(${signed})::text as amount from ledger_entries e
    where e.principal_id = ${principalId} and e.kind in ${SPEND_KINDS} and e.occurred_at >= ${since.toISOString()}
      and coalesce(e.meta->>'model', split_part(e.resource, ':', 2)) <> ''
    group by 1 order by 2 desc limit 10`);
  const outcomes = await tx.execute<{ outcome: string; n: string }>(sql`
    select outcome, count(*)::text as n from gateway_requests where principal_id = ${principalId} and created_at >= ${since.toISOString()} group by 1`);
  const approvals = await tx.execute<{ status: string; n: string }>(sql`
    select status, count(*)::text as n from approvals where requester_principal_id = ${principalId} and created_at >= ${since.toISOString()} group by 1`);
  const subject = `principal:${principalId}`;
  const audit = await tx
    .select({
      seq: schema.auditEvents.seq,
      occurredAt: schema.auditEvents.occurredAt,
      actor: schema.auditEvents.actor,
      action: schema.auditEvents.action,
    })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.orgId, orgId),
        or(eq(schema.auditEvents.subject, subject), eq(schema.auditEvents.actor, `agent:${principalId}`)),
      ),
    )
    .orderBy(desc(schema.auditEvents.seq))
    .limit(20);
  const [killSwitch] = (
    await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from audit_events where org_id = ${orgId} and occurred_at >= ${since.toISOString()}
        and (action = 'agents.paused_all' or (subject = ${subject} and action in ('principal.paused', 'principal.paused_self')))`)
  ).rows;
  const [last] = (
    await tx.execute<{ at: Date | null }>(sql`
      select greatest(
        (select max(created_at) from gateway_requests where principal_id = ${principalId}),
        (select max(occurred_at) from ledger_entries where principal_id = ${principalId})) as at`)
  ).rows;
  const [run] = await tx
    .select()
    .from(schema.postureRuns)
    .where(eq(schema.postureRuns.orgId, orgId))
    .orderBy(desc(schema.postureRuns.ranAt))
    .limit(1);
  const posture = ((run?.results ?? []) as CheckResult[])
    .filter((result) => [...result.subjects, ...result.waivedSubjects].some((s) => s.id === principalId))
    .map((result) => ({ id: result.id, title: result.title, severity: result.severity, status: result.status }));

  const railTotals = Object.fromEntries(byRail.rows.map((row) => [row.rail, BigInt(row.amount)]));
  const nonProvider = Object.entries(railTotals).some(([rail, amount]) => rail !== 'provider' && amount !== 0n);
  const count = (rows: { n: string }[], match: (row: { n: string } & Record<string, string>) => boolean) =>
    rows
      .filter((row) => match(row as { n: string } & Record<string, string>))
      .reduce((sum, row) => sum + Number(row.n), 0);
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    team: team ?? null,
    owner: owner === undefined ? null : { id: owner.id, name: owner.name, isMember: owner.memberId !== null },
    parent: parent ?? null,
    createdAt: agent.createdAt.toISOString(),
    declared: { purpose: agent.purpose, dataClasses: agent.dataClasses, riskTier: agent.riskTier },
    governance:
      keys.length > 0 || cards.length > 0 || x402.length > 0 || nonProvider || Object.keys(railTotals).length === 0
        ? 'enforced'
        : 'visible',
    budgets: budgets.rows.map((b) => ({
      id: b.id,
      name: b.name,
      scope: b.scope,
      mode: b.mode,
      period: b.period,
      limit: usd(BigInt(b.limit_amount)),
      spent: usd(BigInt(b.spent)),
      held: usd(BigInt(b.held)),
    })),
    rules,
    mandates: mandates.map((m) => ({
      id: m.id,
      purpose: m.purpose,
      expiresAt: m.expiresAt.toISOString(),
      parentId: m.parentId,
      uses: m.uses,
      maxUses: m.maxUses,
    })),
    subAgents,
    means: {
      keys: keys.map((k) => ({
        ...k,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        expiresAt: k.expiresAt?.toISOString() ?? null,
      })),
      providerKeys,
      cards,
      x402Accounts: x402,
    },
    activity: {
      spendByRail: Object.fromEntries(Object.entries(railTotals).map(([rail, amount]) => [rail, usd(amount)])),
      spendByModel: byModel.rows.map((row) => ({ model: row.model, amount: usd(BigInt(row.amount)) })),
      outcomes: Object.fromEntries(outcomes.rows.map((row) => [row.outcome, Number(row.n)])),
      approvals: {
        asked: count(approvals.rows, () => true),
        granted: count(approvals.rows, (row) => row.status === 'approved' || row.status === 'used'),
        denied: count(approvals.rows, (row) => row.status === 'denied'),
      },
      killSwitchEvents: Number(killSwitch?.n ?? 0),
      lastActivityAt: last?.at == null ? null : new Date(last.at).toISOString(),
    },
    recentAudit: audit.map((event) => ({
      seq: event.seq,
      occurredAt: event.occurredAt.toISOString(),
      actor: event.actor,
      action: event.action,
    })),
    posture,
    generatedAt: new Date().toISOString(),
  };
}

async function readableCard(
  deps: AppDeps,
  membership: Parameters<typeof reachOf>[0],
  orgId: string,
  principalId: string,
) {
  const card = await withOrg(deps.db, orgId, (tx) => buildCard(tx, orgId, principalId));
  // Card reads follow inventory.read (plan §11.8): a team lead sees only their team's agents,
  // because the card carries spend, keys and audit events, unlike the agents list.
  const reach = reachOf(membership, 'inventory.read');
  if (reach.kind === 'team' && card.team?.id !== reach.teamId) throw notFound('agent');
  return card;
}

export function registerAgentCardRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'inventory.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/agents/{principalId}/card',
      tags: ['agents'],
      summary: 'The agent card: identity, declared purpose, authority, means to spend, activity, and posture',
      request: { params: PrincipalParams },
      responses: { 200: json(AgentCardSchema), ...errorResponses },
    }),
    async (c) => {
      const { orgId, principalId } = c.req.valid('param');
      return c.json(await readableCard(deps, c.var.membership, orgId, principalId), 200);
    },
  );

  router.add(
    { permission: 'inventory.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/agents/{principalId}/card.jws',
      tags: ['agents'],
      summary: 'The agent card signed by the attestation key (for a registry or a vendor questionnaire)',
      request: { params: PrincipalParams },
      responses: { 200: json(z.object({ jws: z.string(), kid: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const { orgId, principalId } = c.req.valid('param');
      const card = await readableCard(deps, c.var.membership, orgId, principalId);
      const key = await withOrg(deps.db, orgId, (tx) => platformSigningKey(tx, deps.ring));
      const jws = signJws({ type: 'aperture.agent-card', version: 1, org: orgId, card }, key, AGENT_CARD_TYP);
      return c.json({ jws, kid: key.kid }, 200, {
        'content-disposition': `attachment; filename="agent-card-${principalId}.jws"`,
      });
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'patch',
      path: '/api/v1/orgs/{orgId}/agents/{principalId}/governance',
      tags: ['agents'],
      summary: 'Declare an agent’s purpose and data classes; owners and admins also set its risk tier',
      request: {
        params: PrincipalParams,
        ...jsonBody(
          z.object({
            purpose: z.string().trim().max(500).nullable().optional(),
            dataClasses: z.array(z.enum(DATA_CLASSES)).max(5).optional(),
            riskTier: z.enum(['low', 'medium', 'high']).nullable().optional(),
          }),
        ),
      },
      responses: { 200: json(AgentCardSchema.shape.declared), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const membership = c.var.membership;
      const { orgId, principalId } = c.req.valid('param');
      const body = c.req.valid('json');
      if (body.riskTier !== undefined && membership.role !== 'owner' && membership.role !== 'admin')
        throw forbidden('only owners and admins set an agent’s risk tier');
      const updated = await withOrg(deps.db, orgId, async (tx) => {
        const [agent] = await tx
          .select()
          .from(schema.principals)
          .where(
            and(
              eq(schema.principals.id, principalId),
              eq(schema.principals.orgId, orgId),
              eq(schema.principals.kind, 'agent'),
              isNull(schema.principals.systemRole),
            ),
          );
        if (!agent) throw notFound('agent');
        const reach = reachOf(membership, 'agents.manage');
        if (reach.kind === 'team' && agent.teamId !== reach.teamId)
          throw forbidden('you can only manage agents in your team');
        const changes = {
          ...(body.purpose === undefined ? {} : { purpose: body.purpose === '' ? null : body.purpose }),
          ...(body.dataClasses === undefined ? {} : { dataClasses: [...new Set(body.dataClasses)] }),
          ...(body.riskTier === undefined ? {} : { riskTier: body.riskTier }),
        };
        if (Object.keys(changes).length === 0)
          throw new AppError(400, 'nothing_to_change', 'send purpose, dataClasses, or riskTier');
        const [row] = await tx
          .update(schema.principals)
          .set(changes)
          .where(eq(schema.principals.id, principalId))
          .returning();
        if (!row) throw notFound('agent');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'agent.governance.updated',
          subject: `principal:${principalId}`,
          data: {
            purpose: row.purpose,
            dataClasses: row.dataClasses,
            riskTier: row.riskTier,
            previousRiskTier: agent.riskTier,
          },
        });
        return row;
      });
      return c.json({ purpose: updated.purpose, dataClasses: updated.dataClasses, riskTier: updated.riskTier }, 200);
    },
  );
}
