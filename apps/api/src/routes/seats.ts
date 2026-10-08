import { randomBytes } from 'node:crypto';
import { SEAT_PROVIDER_IDS, SEAT_PROVIDER_INFO, seatConnectorFor, ConnectorError } from '@aperture/connectors';
import {
  AI_TOOLS,
  formatUsd,
  micros,
  parseUsd,
  seatInsights,
  seatMonthlyCost,
  toolById,
  type InsightSeat,
  type InsightUsage,
} from '@aperture/core';
import { hashApiKey } from '@aperture/crypto';
import {
  and,
  convertToMicros,
  createConnection,
  desc,
  eq,
  inArray,
  isNull,
  schema,
  sql,
  upsertSeat,
  withOrg,
  type Transaction,
} from '@aperture/db';
import { syncSeatConnection } from '@aperture/jobs';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, forbidden, notFound } from '../http/errors';
import { reachOf } from '../http/scope';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';
import { importParsedReceipt, processReceipt, receiptsToken } from '../receipts';

/*
 * Seats, subscriptions, the AI tool catalogue, members' own AI tools, telemetry tokens, and the
 * receipts inbox (plan/phases/phase-12). Seats are visible, never enforced (INV-17).
 */

const usd = (value: bigint) => formatUsd(micros(value));
const TELEMETRY_PREFIX = 'apt_tel_';
const SEAT_SOURCES = ['connector', 'receipt', 'statement', 'declared', 'import', 'manual'] as const;
const PAYERS = ['company', 'personal_expensed', 'personal_unexpensed', 'unknown'] as const;
/** Inline (not the shared Usd component) so null survives into the OpenAPI document. */
const UsdAmount = z.string().regex(/^\d+(\.\d{1,6})?$/, 'a USD amount such as "12.50"');
const SeatParams = OrgParams.extend({ seatId: z.uuid().openapi({ param: { name: 'seatId', in: 'path' } }) });

const SeatSchema = z
  .object({
    id: z.uuid(),
    toolId: z.string(),
    tool: z.string(),
    category: z.string(),
    plan: z.string().nullable(),
    planName: z.string().nullable(),
    holder: z.object({ userId: z.string(), name: z.string(), email: z.string(), isMember: z.boolean() }).nullable(),
    externalUserRef: z.string().nullable(),
    source: z.enum(SEAT_SOURCES),
    payer: z.enum(PAYERS),
    status: z.enum(['active', 'idle', 'cancelled']),
    monthlyCost: z.string().nullable(),
    listPrice: z.string().nullable(),
    renewsOn: z.string().nullable(),
    lastActiveAt: Timestamp.nullable(),
    activeDays30: z.number().int(),
    requests30: z.number().int(),
    extraUsage30: z.string(),
    connectionId: z.uuid().nullable(),
    note: z.string().nullable(),
  })
  .openapi('Seat');

const InsightSchema = z
  .object({
    kind: z.enum(['idle_seat', 'duplicate', 'consolidate', 'seat_vs_api', 'unapproved_tool']),
    toolId: z.string(),
    seatIds: z.array(z.string()),
    userIds: z.array(z.string()),
    monthlySaving: z.string(),
    detail: z.string(),
  })
  .openapi('SeatInsight');

const TelemetryTokenSchema = z
  .object({
    id: z.uuid(),
    userId: z.string(),
    tool: z.string(),
    name: z.string(),
    prefix: z.string(),
    lastUsedAt: Timestamp.nullable(),
    revokedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi('TelemetryToken');

const ReceiptSchema = z
  .object({
    id: z.uuid(),
    duplicate: z.boolean(),
    status: z.enum(['imported', 'review', 'dismissed']),
    reason: z.string().nullable(),
    toolId: z.string().nullable(),
    plan: z.string().nullable(),
    amount: z.string().nullable(),
    currency: z.string().nullable(),
    occurredOn: z.string().nullable(),
  })
  .openapi('ReceiptOutcome');

type TokenRow = typeof schema.telemetryTokens.$inferSelect;
const tokenView = (t: TokenRow) => ({
  id: t.id,
  userId: t.userId,
  tool: t.tool,
  name: t.name,
  prefix: t.prefix,
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  revokedAt: t.revokedAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
});

const optionalUsd = (value: string | null | undefined) =>
  value === null || value === undefined ? null : parseUsd(value);

export function registerSeatRoutes(router: Router, deps: AppDeps): void {
  async function seatRows(orgId: string, teamId: string | null) {
    return withOrg(deps.db, orgId, async (tx) => {
      const rows = await tx.execute<{
        id: string;
        tool_id: string;
        plan: string | null;
        user_id: string | null;
        user_name: string | null;
        user_email: string | null;
        is_member: boolean;
        team_id: string | null;
        external_user_ref: string | null;
        source: (typeof SEAT_SOURCES)[number];
        payer: (typeof PAYERS)[number];
        status: 'active' | 'idle' | 'cancelled';
        monthly_cost: string | null;
        renews_on: string | null;
        last_active_at: Date | null;
        connection_id: string | null;
        note: string | null;
        active_days: string;
        requests: string;
        extra: string;
        estimated: string;
      }>(sql`
        select s.id, s.tool_id, s.plan, s.user_id, u.name as user_name, u.email as user_email,
               (m.id is not null) as is_member, m.team_id, s.external_user_ref, s.source, s.payer, s.status,
               s.monthly_cost::text, s.renews_on, s.last_active_at, s.connection_id, s.note,
               count(d.day) filter (where d.active)::text as active_days,
               coalesce(sum(d.requests), 0)::text as requests,
               coalesce(sum(d.extra_usage_cost), 0)::text as extra,
               coalesce(sum(d.estimated_cost), 0)::text as estimated
        from seats s
        left join users u on u.id = s.user_id
        left join members m on m.org_id = s.org_id and m.user_id = s.user_id
        left join seat_usage_daily d on d.seat_id = s.id and d.day >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
        where s.org_id = ${orgId} ${teamId === null ? sql`` : sql`and m.team_id = ${teamId}`}
        group by s.id, u.name, u.email, m.id, m.team_id
        order by s.tool_id, u.name nulls last`);
      return rows.rows;
    });
  }

  router.add(
    { permission: 'seats.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/seats',
      tags: ['seats'],
      summary: 'Every AI seat and subscription the org knows about, with 30-day activity',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            seats: z.array(SeatSchema),
            totals: z.object({
              seats: z.number().int(),
              monthlyCost: z.string(),
              byPayer: z.record(z.string(), z.number().int()),
            }),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const reach = reachOf(c.var.membership, 'seats.read');
      const rows = await seatRows(orgId, reach.kind === 'team' ? reach.teamId : null);
      const seats = rows.map((row) => {
        const tool = toolById(row.tool_id);
        const listPrice = tool?.plans.find((p) => p.id === row.plan)?.monthlyUsd ?? null;
        return {
          id: row.id,
          toolId: row.tool_id,
          tool: tool?.product ?? row.tool_id,
          category: tool?.category ?? 'other',
          plan: row.plan,
          planName: tool?.plans.find((p) => p.id === row.plan)?.name ?? null,
          holder:
            row.user_id === null
              ? null
              : {
                  userId: row.user_id,
                  name: row.user_name ?? '',
                  email: row.user_email ?? '',
                  isMember: row.is_member,
                },
          externalUserRef: row.external_user_ref,
          source: row.source,
          payer: row.payer,
          status: row.status,
          monthlyCost: row.monthly_cost === null ? null : usd(BigInt(row.monthly_cost)),
          listPrice,
          renewsOn: row.renews_on,
          lastActiveAt: row.last_active_at === null ? null : new Date(row.last_active_at).toISOString(),
          activeDays30: Number(row.active_days),
          requests30: Number(row.requests),
          extraUsage30: usd(BigInt(row.extra)),
          connectionId: row.connection_id,
          note: row.note,
        };
      });
      const live = rows.filter((row) => row.status !== 'cancelled');
      const monthly = live.reduce(
        (sum, row) => sum + seatMonthlyCost({ toolId: row.tool_id, plan: row.plan, monthlyCost: row.monthly_cost }),
        0n,
      );
      const byPayer: Record<string, number> = {};
      for (const row of live) byPayer[row.payer] = (byPayer[row.payer] ?? 0) + 1;
      return c.json({ seats, totals: { seats: live.length, monthlyCost: usd(monthly), byPayer } }, 200);
    },
  );

  router.add(
    { permission: 'seats.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/seats',
      tags: ['seats'],
      summary: 'Record a seat by hand (a tool without a connector, receipt, or import)',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            toolId: z.string().min(1).max(60),
            plan: z.string().max(60).nullable().default(null),
            userId: z.string().max(100).nullable().default(null),
            payer: z.enum(PAYERS).default('company'),
            monthlyCostUsd: UsdAmount.nullable().default(null),
            renewsOn: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .nullable()
              .default(null),
            note: z.string().trim().max(500).nullable().default(null),
          }),
        ),
      },
      responses: { 201: json(z.object({ id: z.uuid() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const tool = toolById(body.toolId);
      if (tool === undefined) throw new AppError(400, 'unknown_tool', `no tool ${body.toolId} in the catalogue`);
      if (body.plan !== null && !tool.plans.some((p) => p.id === body.plan))
        throw new AppError(400, 'unknown_plan', 'no such plan');
      const id = await withOrg(deps.db, orgId, async (tx) => {
        if (body.userId !== null) await assertMember(tx, orgId, body.userId);
        const seat = await upsertSeat(tx, {
          orgId,
          dedupeKey: `manual:${uuidv7()}`,
          toolId: tool.id,
          plan: body.plan,
          userId: body.userId,
          externalUserRef: null,
          source: 'manual',
          payer: body.payer,
          monthlyCost: optionalUsd(body.monthlyCostUsd),
          renewsOn: body.renewsOn,
        });
        if (body.note !== null)
          await tx.update(schema.seats).set({ note: body.note }).where(eq(schema.seats.id, seat.id));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'seat.created',
          subject: `seat:${seat.id}`,
          data: { toolId: tool.id, plan: body.plan, payer: body.payer },
        });
        return seat.id;
      });
      return c.json({ id }, 201);
    },
  );

  router.add(
    { permission: 'seats.manage' },
    createRoute({
      method: 'patch',
      path: '/api/v1/orgs/{orgId}/seats/{seatId}',
      tags: ['seats'],
      summary: 'Link a seat to a member, set who pays and what it costs, or cancel it',
      request: {
        params: SeatParams,
        ...jsonBody(
          z.object({
            userId: z.string().max(100).nullable().optional(),
            payer: z.enum(PAYERS).optional(),
            plan: z.string().max(60).nullable().optional(),
            monthlyCostUsd: UsdAmount.nullable().optional(),
            status: z.enum(['active', 'cancelled']).optional(),
            note: z.string().trim().max(500).nullable().optional(),
          }),
        ),
      },
      responses: { 200: json(z.object({ id: z.uuid() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, seatId } = c.req.valid('param');
      const body = c.req.valid('json');
      await withOrg(deps.db, orgId, async (tx) => {
        const [seat] = await tx
          .select()
          .from(schema.seats)
          .where(and(eq(schema.seats.id, seatId), eq(schema.seats.orgId, orgId)));
        if (!seat) throw notFound('seat');
        if (body.userId != null) await assertMember(tx, orgId, body.userId);
        if (body.plan != null && !(toolById(seat.toolId)?.plans.some((p) => p.id === body.plan) ?? false))
          throw new AppError(400, 'unknown_plan', 'no such plan');
        await tx
          .update(schema.seats)
          .set({
            ...(body.userId === undefined ? {} : { userId: body.userId }),
            ...(body.payer === undefined ? {} : { payer: body.payer }),
            ...(body.plan === undefined ? {} : { plan: body.plan }),
            ...(body.monthlyCostUsd === undefined ? {} : { monthlyCost: optionalUsd(body.monthlyCostUsd) }),
            ...(body.status === undefined ? {} : { status: body.status }),
            ...(body.note === undefined ? {} : { note: body.note }),
            updatedAt: new Date(),
          })
          .where(eq(schema.seats.id, seatId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'seat.updated',
          subject: `seat:${seatId}`,
          data: { ...body, userId: body.userId ?? null, note: body.note ?? null } as Record<string, string | null>,
        });
      });
      return c.json({ id: seatId }, 200);
    },
  );

  router.add(
    { permission: 'seats.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/seats/import',
      tags: ['seats'],
      summary: 'Import seats from an admin-console export (ChatGPT, Gemini, or any tool without a connector)',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            toolId: z.string().min(1).max(60),
            plan: z.string().max(60).nullable().default(null),
            rows: z
              .array(
                z.object({
                  email: z.email().max(254),
                  plan: z.string().max(60).nullable().optional(),
                  lastActiveAt: z.iso.date().nullable().optional(),
                  monthlyCostUsd: UsdAmount.nullable().optional(),
                }),
              )
              .min(1)
              .max(5000),
          }),
        ),
      },
      responses: {
        201: json(z.object({ seats: z.number().int(), matched: z.number().int(), created: z.number().int() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const tool = toolById(body.toolId);
      if (tool === undefined) throw new AppError(400, 'unknown_tool', `no tool ${body.toolId} in the catalogue`);
      const result = await withOrg(deps.db, orgId, async (tx) => {
        const people = await tx
          .select({ userId: schema.members.userId, email: schema.users.email })
          .from(schema.members)
          .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(eq(schema.members.orgId, orgId));
        const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p.userId]));
        let matched = 0;
        let created = 0;
        for (const row of body.rows) {
          const email = row.email.toLowerCase();
          const userId = byEmail.get(email) ?? null;
          if (userId !== null) matched += 1;
          const plan = row.plan ?? body.plan;
          const seat = await upsertSeat(tx, {
            orgId,
            dedupeKey: `import:${tool.id}:${email}`,
            toolId: tool.id,
            plan: plan !== null && tool.plans.some((p) => p.id === plan) ? plan : null,
            userId,
            externalUserRef: email,
            source: 'import',
            payer: 'company',
            monthlyCost: optionalUsd(row.monthlyCostUsd),
            lastActiveAt: row.lastActiveAt == null ? null : new Date(`${row.lastActiveAt}T00:00:00Z`),
          });
          if (seat.created) created += 1;
        }
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'seats.imported',
          subject: `tool:${tool.id}`,
          data: { rows: body.rows.length, matched, created },
        });
        return { seats: body.rows.length, matched, created };
      });
      return c.json(result, 201);
    },
  );

  router.add(
    { permission: 'seats.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/seats/insights',
      tags: ['seats'],
      summary: 'Idle seats, duplicates, consolidation, seat-versus-API, and unapproved tools, with estimated savings',
      request: { params: OrgParams },
      responses: {
        200: json(z.object({ insights: z.array(InsightSchema), monthlySaving: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const reach = reachOf(c.var.membership, 'seats.read');
      const rows = await seatRows(orgId, reach.kind === 'team' ? reach.teamId : null);
      const { approved, usage, idleDays } = await withOrg(deps.db, orgId, async (tx) => {
        const approvedRows = await tx
          .select({ toolId: schema.approvedTools.toolId })
          .from(schema.approvedTools)
          .where(eq(schema.approvedTools.orgId, orgId));
        // Terminal telemetry: Claude Code usage counts against Claude seats (Pro/Max/Team include it).
        const telemetry = await tx.execute<{ user_id: string; cost: string }>(sql`
          select user_id, sum(cost)::text as cost from tool_usage_daily
          where org_id = ${orgId} and tool = 'claude_code' and day >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
          group by user_id`);
        const [settings] = await tx
          .select({ idle: schema.orgSettings.idleSeatDays })
          .from(schema.orgSettings)
          .where(eq(schema.orgSettings.orgId, orgId));
        return {
          approved: approvedRows.map((r) => r.toolId),
          usage: telemetry.rows.flatMap((row): InsightUsage[] => [
            { userId: row.user_id, toolId: 'claude', last30Days: BigInt(row.cost) },
            { userId: row.user_id, toolId: 'claude_code', last30Days: BigInt(row.cost) },
          ]),
          idleDays: settings?.idle ?? 30,
        };
      });
      // Connector-reported list-price usage (Claude Code analytics) counts too.
      for (const row of rows)
        if (row.user_id !== null && BigInt(row.estimated) > 0n)
          usage.push({ userId: row.user_id, toolId: row.tool_id, last30Days: BigInt(row.estimated) });
      const seats: InsightSeat[] = rows.map((row) => ({
        id: row.id,
        toolId: row.tool_id,
        plan: row.plan,
        userId: row.user_id,
        payer: row.payer,
        // A seat whose holder left the org is reclaimable whatever its activity (S1).
        status: row.user_id !== null && !row.is_member && row.status !== 'cancelled' ? 'idle' : row.status,
        source: row.source,
        monthlyCost: row.monthly_cost,
        lastActiveAt: row.last_active_at === null ? null : new Date(row.last_active_at).toISOString(),
      }));
      const insights = seatInsights({ seats, usage, approvedTools: approved, idleDays, now: new Date() });
      const total = insights.reduce((sum, i) => sum + i.monthlySaving, 0n);
      return c.json(
        {
          insights: insights.map((i) => ({ ...i, monthlySaving: usd(i.monthlySaving) })),
          monthlySaving: usd(total),
        },
        200,
      );
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Seat connections (read-only admin APIs).

  router.add(
    { permission: 'seats.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/seat-providers',
      tags: ['seats'],
      summary: 'Products whose seats Aperture can read, and how to connect each',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            providers: z.array(
              z.object({
                provider: z.enum(SEAT_PROVIDER_IDS),
                name: z.string(),
                toolId: z.string(),
                secretLabel: z.string(),
                secretUrl: z.string(),
                requires: z.string(),
                steps: z.array(z.string()),
                configFields: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean() })),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    (c) => c.json({ providers: Object.values(SEAT_PROVIDER_INFO) }, 200),
  );

  router.add(
    { permission: 'seats.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/seat-connections',
      tags: ['seats'],
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            connections: z.array(
              z.object({
                id: z.uuid(),
                provider: z.string(),
                name: z.string(),
                status: z.string(),
                lastSyncedAt: Timestamp.nullable(),
                lastError: z.string().nullable(),
                seats: z.number().int(),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx.execute<{
          id: string;
          provider: string;
          name: string;
          status: string;
          last_synced_at: Date | null;
          last_error: string | null;
          seats: string;
        }>(sql`
          select c.id, c.provider, c.name, c.status, c.last_synced_at, c.last_error,
                 (select count(*) from seats s where s.connection_id = c.id and s.status <> 'cancelled')::text as seats
          from connections c where c.org_id = ${orgId} and c.provider like 'seat:%' and c.status <> 'disabled'
          order by c.created_at`),
      );
      return c.json(
        {
          connections: rows.rows.map((r) => ({
            id: r.id,
            provider: r.provider,
            name: r.name,
            status: r.status,
            lastSyncedAt: r.last_synced_at === null ? null : new Date(r.last_synced_at).toISOString(),
            lastError: r.last_error,
            seats: Number(r.seats),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'seats.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/seat-connections',
      tags: ['seats'],
      summary: 'Connect a seat product (the key is tested, stored encrypted, never returned, and only used to read)',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            provider: z.enum(SEAT_PROVIDER_IDS),
            name: z.string().trim().min(1).max(80).optional(),
            secret: z.string().min(8).max(4000),
            config: z.record(z.string(), z.string().max(200)).default({}),
          }),
        ),
      },
      responses: {
        201: json(z.object({ id: z.uuid(), seats: z.number().int(), matched: z.number().int() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const info = SEAT_PROVIDER_INFO[body.provider];
      for (const field of info.configFields)
        if (field.required && (body.config[field.key] ?? '') === '')
          throw new AppError(400, 'missing_config', `${field.label} is required`);
      let fingerprint: string;
      try {
        const connector = seatConnectorFor(body.provider, {
          secret: body.secret,
          config: body.config,
          fetch: deps.jobs.fetch,
        });
        fingerprint = (await connector.test()).fingerprint;
      } catch (error) {
        if (error instanceof ConnectorError) throw new AppError(400, `provider_${error.code}`, error.message);
        throw error;
      }
      const created = await withOrg(deps.db, orgId, async (tx) => {
        const [duplicate] = await tx
          .select({ id: schema.connections.id })
          .from(schema.connections)
          .where(
            and(
              eq(schema.connections.orgId, orgId),
              eq(schema.connections.provider, body.provider),
              eq(schema.connections.fingerprint, fingerprint),
              sql`${schema.connections.status} <> 'disabled'`,
            ),
          );
        if (duplicate) throw new AppError(409, 'already_connected', `this ${info.name} account is already connected`);
        const connection = await createConnection(tx, deps.ring, {
          orgId,
          provider: body.provider,
          name: body.name ?? info.name,
          secret: body.secret,
          fingerprint,
          config: body.config,
        });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'seat_connection.created',
          subject: `connection:${connection.id}`,
          data: { provider: body.provider },
        });
        return connection;
      });
      const [row] = await withOrg(deps.db, orgId, (tx) =>
        tx.select().from(schema.connections).where(eq(schema.connections.id, created.id)),
      );
      if (!row) throw new Error('connection missing after insert');
      const synced = await syncSeatConnection(deps.jobs, row).catch((error: unknown) => {
        deps.logger.warn({ err: error, connection: row.id }, 'first seat sync failed');
        return { seats: 0, matched: 0, days: 0 };
      });
      return c.json({ id: created.id, seats: synced.seats, matched: synced.matched }, 201);
    },
  );

  const ConnectionParams = OrgParams.extend({
    connectionId: z.uuid().openapi({ param: { name: 'connectionId', in: 'path' } }),
  });
  const loadSeatConnection = async (orgId: string, connectionId: string) => {
    const [row] = await withOrg(deps.db, orgId, (tx) =>
      tx
        .select()
        .from(schema.connections)
        .where(
          and(
            eq(schema.connections.id, connectionId),
            eq(schema.connections.orgId, orgId),
            sql`${schema.connections.provider} like 'seat:%'`,
          ),
        ),
    );
    if (!row || row.status === 'disabled') throw notFound('seat connection');
    return row;
  };

  router.add(
    { permission: 'seats.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/seat-connections/{connectionId}/sync',
      tags: ['seats'],
      request: { params: ConnectionParams },
      responses: {
        200: json(z.object({ seats: z.number().int(), matched: z.number().int(), days: z.number().int() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId, connectionId } = c.req.valid('param');
      const connection = await loadSeatConnection(orgId, connectionId);
      try {
        return c.json(await syncSeatConnection(deps.jobs, connection), 200);
      } catch (error) {
        if (error instanceof ConnectorError) throw new AppError(400, `provider_${error.code}`, error.message);
        throw error;
      }
    },
  );

  router.add(
    { permission: 'seats.manage' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/seat-connections/{connectionId}',
      tags: ['seats'],
      summary: 'Disconnect (seats it found stay listed, marked as no longer synced)',
      request: { params: ConnectionParams },
      responses: { 204: { description: 'Disconnected' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, connectionId } = c.req.valid('param');
      await loadSeatConnection(orgId, connectionId);
      await withOrg(deps.db, orgId, async (tx) => {
        await tx
          .update(schema.connections)
          .set({ status: 'disabled', updatedAt: new Date() })
          .where(eq(schema.connections.id, connectionId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'seat_connection.disabled',
          subject: `connection:${connectionId}`,
        });
      });
      return c.body(null, 204);
    },
  );

  // ---------------------------------------------------------------------------------------------
  // The AI tool catalogue and the approved list.

  router.add(
    { permission: 'tools.declare' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/tools',
      tags: ['tools'],
      summary: 'The AI tool catalogue, the org’s approved list, and how many people use each tool',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            tools: z.array(
              z.object({
                id: z.string(),
                vendor: z.string(),
                product: z.string(),
                category: z.string(),
                pricing: z.string(),
                approved: z.boolean(),
                users: z.number().int(),
                plans: z.array(
                  z.object({ id: z.string(), name: z.string(), monthlyUsd: z.string().nullable(), team: z.boolean() }),
                ),
              }),
            ),
            approvedCount: z.number().int(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { approved, users } = await withOrg(deps.db, orgId, async (tx) => ({
        approved: new Set(
          (
            await tx
              .select({ toolId: schema.approvedTools.toolId })
              .from(schema.approvedTools)
              .where(eq(schema.approvedTools.orgId, orgId))
          ).map((r) => r.toolId),
        ),
        users: new Map(
          (
            await tx.execute<{ tool_id: string; n: string }>(sql`
              select tool_id, count(distinct coalesce(user_id, external_user_ref, id::text))::text as n
              from seats where org_id = ${orgId} and status <> 'cancelled' group by tool_id`)
          ).rows.map((r) => [r.tool_id, Number(r.n)]),
        ),
      }));
      return c.json(
        {
          tools: AI_TOOLS.map((tool) => ({
            id: tool.id,
            vendor: tool.vendor,
            product: tool.product,
            category: tool.category,
            pricing: tool.pricing,
            approved: approved.has(tool.id),
            users: users.get(tool.id) ?? 0,
            plans: tool.plans.map((p) => ({ ...p })),
          })),
          approvedCount: approved.size,
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'seats.manage' },
    createRoute({
      method: 'put',
      path: '/api/v1/orgs/{orgId}/tools/approved',
      tags: ['tools'],
      summary: 'Replace the approved AI tools list',
      request: { params: OrgParams, ...jsonBody(z.object({ toolIds: z.array(z.string().min(1).max(60)).max(200) })) },
      responses: { 200: json(z.object({ toolIds: z.array(z.string()) })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const toolIds = [...new Set(c.req.valid('json').toolIds)];
      const unknown = toolIds.filter((id) => toolById(id) === undefined);
      if (unknown.length > 0) throw new AppError(400, 'unknown_tool', `not in the catalogue: ${unknown.join(', ')}`);
      await withOrg(deps.db, orgId, async (tx) => {
        await tx.delete(schema.approvedTools).where(eq(schema.approvedTools.orgId, orgId));
        if (toolIds.length > 0)
          await tx.insert(schema.approvedTools).values(toolIds.map((toolId) => ({ orgId, toolId, addedBy: user.id })));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'tools.approved_changed',
          subject: `org:${orgId}`,
          data: { toolIds },
        });
      });
      return c.json({ toolIds }, 200);
    },
  );

  // ---------------------------------------------------------------------------------------------
  // My AI tools: declarations, confirmation, telemetry tokens, receipts.

  const MyToolSchema = z.object({
    seatId: z.uuid(),
    toolId: z.string(),
    tool: z.string(),
    plan: z.string().nullable(),
    payer: z.enum(PAYERS),
    source: z.enum(SEAT_SOURCES),
    monthlyCost: z.string().nullable(),
    lastActiveAt: Timestamp.nullable(),
  });

  router.add(
    { permission: 'tools.declare' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/me/tools',
      tags: ['tools'],
      summary: 'Your AI tools (declared, found on receipts, or from connectors), confirmation, and setup details',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            tools: z.array(MyToolSchema),
            confirmedAt: Timestamp.nullable(),
            receiptsAddress: z.string().nullable(),
            telemetryTokens: z.array(TelemetryTokenSchema),
            gatewayUrl: z.string().nullable(),
            telemetryUsage30d: z.object({ sessions: z.number().int(), cost: z.string() }),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const data = await withOrg(deps.db, orgId, async (tx) => {
        const seats = await tx
          .select()
          .from(schema.seats)
          .where(
            and(
              eq(schema.seats.orgId, orgId),
              eq(schema.seats.userId, user.id),
              sql`${schema.seats.status} <> 'cancelled'`,
            ),
          );
        const [confirmation] = await tx
          .select()
          .from(schema.toolConfirmations)
          .where(and(eq(schema.toolConfirmations.orgId, orgId), eq(schema.toolConfirmations.userId, user.id)));
        const tokens = await tx
          .select()
          .from(schema.telemetryTokens)
          .where(and(eq(schema.telemetryTokens.orgId, orgId), eq(schema.telemetryTokens.userId, user.id)))
          .orderBy(desc(schema.telemetryTokens.createdAt));
        const [usage] = (
          await tx.execute<{ sessions: string; cost: string }>(sql`
            select coalesce(sum(sessions), 0)::text as sessions, coalesce(sum(cost), 0)::text as cost from tool_usage_daily
            where org_id = ${orgId} and user_id = ${user.id} and day >= to_char(now() - interval '30 days', 'YYYY-MM-DD')`)
        ).rows;
        return { seats, confirmation, tokens, usage };
      });
      return c.json(
        {
          tools: data.seats.map((seat) => ({
            seatId: seat.id,
            toolId: seat.toolId,
            tool: toolById(seat.toolId)?.product ?? seat.toolId,
            plan: seat.plan,
            payer: seat.payer,
            source: seat.source,
            monthlyCost: seat.monthlyCost === null ? null : usd(seat.monthlyCost),
            lastActiveAt: seat.lastActiveAt?.toISOString() ?? null,
          })),
          confirmedAt: data.confirmation?.confirmedAt.toISOString() ?? null,
          receiptsAddress:
            deps.inboundEmail === undefined
              ? null
              : `receipts-${await receiptsToken(deps, orgId)}@${deps.inboundEmail.domain}`,
          telemetryTokens: data.tokens.map(tokenView),
          gatewayUrl: deps.gatewayPublicUrl ?? null,
          telemetryUsage30d: {
            sessions: Number(data.usage?.sessions ?? 0),
            cost: usd(BigInt(data.usage?.cost ?? '0')),
          },
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'tools.declare' },
    createRoute({
      method: 'put',
      path: '/api/v1/orgs/{orgId}/me/tools',
      tags: ['tools'],
      summary: 'Declare the AI tools you use (replaces your previous declaration and counts as a confirmation)',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            tools: z
              .array(
                z.object({
                  toolId: z.string().min(1).max(60),
                  plan: z.string().max(60).nullable().default(null),
                  payer: z.enum(['company', 'personal_expensed', 'personal_unexpensed']),
                  monthlyCostUsd: UsdAmount.nullable().default(null),
                }),
              )
              .max(50),
          }),
        ),
      },
      responses: { 200: json(z.object({ declared: z.number().int() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const { tools } = c.req.valid('json');
      for (const entry of tools) {
        const tool = toolById(entry.toolId);
        if (tool === undefined) throw new AppError(400, 'unknown_tool', `no tool ${entry.toolId} in the catalogue`);
        if (entry.plan !== null && !tool.plans.some((p) => p.id === entry.plan))
          throw new AppError(400, 'unknown_plan', `no such ${tool.product} plan`);
      }
      await withOrg(deps.db, orgId, async (tx) => {
        const keep = new Set(tools.map((t) => `declared:${user.id}:${t.toolId}`));
        const previous = await tx
          .select({ id: schema.seats.id, dedupeKey: schema.seats.dedupeKey })
          .from(schema.seats)
          .where(
            and(eq(schema.seats.orgId, orgId), eq(schema.seats.userId, user.id), eq(schema.seats.source, 'declared')),
          );
        const dropped = previous.filter((p) => !keep.has(p.dedupeKey)).map((p) => p.id);
        if (dropped.length > 0)
          await tx
            .update(schema.seats)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(inArray(schema.seats.id, dropped));
        for (const entry of tools)
          await upsertSeat(tx, {
            orgId,
            dedupeKey: `declared:${user.id}:${entry.toolId}`,
            toolId: entry.toolId,
            plan: entry.plan,
            userId: user.id,
            externalUserRef: null,
            source: 'declared',
            payer: entry.payer,
            monthlyCost: optionalUsd(entry.monthlyCostUsd),
            status: 'active',
          });
        // A re-declared tool comes back from "cancelled"; upsertSeat keeps cancelled for non-connector sources.
        if (tools.length > 0)
          await tx
            .update(schema.seats)
            .set({ status: 'active' })
            .where(and(eq(schema.seats.orgId, orgId), inArray(schema.seats.dedupeKey, [...keep])));
        await tx
          .insert(schema.toolConfirmations)
          .values({ orgId, userId: user.id })
          .onConflictDoUpdate({
            target: [schema.toolConfirmations.orgId, schema.toolConfirmations.userId],
            set: { confirmedAt: new Date() },
          });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'tools.declared',
          subject: `user:${user.id}`,
          data: { tools: tools.map((t) => t.toolId) },
        });
      });
      return c.json({ declared: tools.length }, 200);
    },
  );

  router.add(
    { permission: 'tools.declare' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/me/tools/confirm',
      tags: ['tools'],
      summary: 'Confirm your declared AI tools are still current (the quarterly check)',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ confirmedAt: Timestamp })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const at = new Date();
      await withOrg(deps.db, orgId, (tx) =>
        tx
          .insert(schema.toolConfirmations)
          .values({ orgId, userId: user.id, confirmedAt: at })
          .onConflictDoUpdate({
            target: [schema.toolConfirmations.orgId, schema.toolConfirmations.userId],
            set: { confirmedAt: at },
          }),
      );
      return c.json({ confirmedAt: at.toISOString() }, 200);
    },
  );

  router.add(
    { permission: 'tools.declare' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/me/telemetry-tokens',
      tags: ['tools'],
      summary: 'Create a telemetry token for your terminal tool (shown once; it can only send usage metrics)',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({ tool: z.enum(['claude_code']), name: z.string().trim().min(1).max(80).default('laptop') }),
        ),
      },
      responses: {
        201: json(TelemetryTokenSchema.extend({ token: z.string(), endpoint: z.string().nullable() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const token = `${TELEMETRY_PREFIX}${randomBytes(24).toString('base64url')}`;
      const row = await withOrg(deps.db, orgId, async (tx) => {
        const [created] = await tx
          .insert(schema.telemetryTokens)
          .values({
            id: uuidv7(),
            orgId,
            userId: user.id,
            tool: body.tool,
            name: body.name,
            prefix: token.slice(0, TELEMETRY_PREFIX.length + 4),
            hash: hashApiKey(token, deps.pepper),
            createdBy: user.id,
          })
          .returning();
        if (!created) throw new Error('insert returned no row');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'telemetry_token.created',
          subject: `telemetry_token:${created.id}`,
          data: { tool: body.tool },
        });
        return created;
      });
      return c.json(
        {
          ...tokenView(row),
          token,
          endpoint: deps.gatewayPublicUrl === undefined ? null : `${deps.gatewayPublicUrl.replace(/\/$/, '')}/otlp`,
        },
        201,
      );
    },
  );

  router.add(
    { permission: 'telemetry.manage' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/telemetry-tokens',
      tags: ['tools'],
      summary: 'Every member’s telemetry tokens',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ tokens: z.array(TelemetryTokenSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.telemetryTokens)
          .where(eq(schema.telemetryTokens.orgId, orgId))
          .orderBy(desc(schema.telemetryTokens.createdAt)),
      );
      return c.json({ tokens: rows.map(tokenView) }, 200);
    },
  );

  router.add(
    { permission: 'tools.declare' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/telemetry-tokens/{tokenId}',
      tags: ['tools'],
      summary: 'Revoke a telemetry token (your own, or anyone’s with telemetry.manage)',
      request: { params: OrgParams.extend({ tokenId: z.uuid().openapi({ param: { name: 'tokenId', in: 'path' } }) }) },
      responses: { 204: { description: 'Revoked' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, tokenId } = c.req.valid('param');
      const canManage = c.var.membership.role === 'owner' || c.var.membership.role === 'admin';
      await withOrg(deps.db, orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.telemetryTokens)
          .where(
            and(
              eq(schema.telemetryTokens.id, tokenId),
              eq(schema.telemetryTokens.orgId, orgId),
              isNull(schema.telemetryTokens.revokedAt),
            ),
          );
        if (!row) throw notFound('telemetry token');
        if (row.userId !== user.id && !canManage) throw forbidden('you can only revoke your own telemetry tokens');
        await tx
          .update(schema.telemetryTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.telemetryTokens.id, tokenId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'telemetry_token.revoked',
          subject: `telemetry_token:${tokenId}`,
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'seats.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/tool-usage',
      tags: ['tools'],
      summary: 'Terminal-tool usage per person over the last 30 days (from telemetry)',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            people: z.array(
              z.object({
                userId: z.string(),
                name: z.string(),
                tool: z.string(),
                sessions: z.number().int(),
                tokens: z.string(),
                cost: z.string(),
                linesAdded: z.number().int(),
                commits: z.number().int(),
                lastDay: z.string(),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const reach = reachOf(c.var.membership, 'seats.read');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx.execute<{
          user_id: string;
          name: string;
          tool: string;
          sessions: string;
          tokens: string;
          cost: string;
          lines: string;
          commits: string;
          last_day: string;
        }>(sql`
          select t.user_id, coalesce(u.name, u.email) as name, t.tool, sum(t.sessions)::text as sessions,
                 sum(t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens)::text as tokens,
                 sum(t.cost)::text as cost, sum(t.lines_added)::text as lines, sum(t.commits)::text as commits, max(t.day) as last_day
          from tool_usage_daily t join users u on u.id = t.user_id
          left join members m on m.org_id = t.org_id and m.user_id = t.user_id
          where t.org_id = ${orgId} and t.day >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
            ${reach.kind === 'team' ? sql`and m.team_id = ${reach.teamId}` : sql``}
          group by t.user_id, u.name, u.email, t.tool order by sum(t.cost) desc`),
      );
      return c.json(
        {
          people: rows.rows.map((r) => ({
            userId: r.user_id,
            name: r.name,
            tool: r.tool,
            sessions: Number(r.sessions),
            tokens: r.tokens,
            cost: usd(BigInt(r.cost)),
            linesAdded: Number(r.lines),
            commits: Number(r.commits),
            lastDay: r.last_day,
          })),
        },
        200,
      );
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Receipts.

  router.add(
    { permission: 'tools.declare' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/me/receipts',
      tags: ['receipts'],
      summary: 'Upload a receipt email (.eml, base64) you received from an AI vendor',
      request: { params: OrgParams, ...jsonBody(z.object({ eml: z.base64().max(1_000_000) })) },
      responses: { 201: json(ReceiptSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const raw = new Uint8Array(Buffer.from(c.req.valid('json').eml, 'base64'));
      const outcome = await processReceipt(deps, { orgId, raw, via: 'upload', submittedBy: user.id, fromMember: true });
      return c.json(outcome, 201);
    },
  );

  router.add(
    { permission: 'receipts.review' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/receipts',
      tags: ['receipts'],
      summary: 'Receipts, newest first (the review queue with status=review)',
      request: {
        params: OrgParams,
        query: z.object({ status: z.enum(['imported', 'review', 'dismissed', 'all']).default('all') }),
      },
      responses: {
        200: json(
          z.object({
            receipts: z.array(
              ReceiptSchema.omit({ duplicate: true }).extend({
                via: z.string(),
                trust: z.string(),
                senderDomain: z.string().nullable(),
                submittedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
                createdAt: Timestamp,
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { status } = c.req.valid('query');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ receipt: schema.receipts, name: schema.users.name })
          .from(schema.receipts)
          .leftJoin(schema.users, eq(schema.users.id, schema.receipts.submittedBy))
          .where(
            and(eq(schema.receipts.orgId, orgId), status === 'all' ? undefined : eq(schema.receipts.status, status)),
          )
          .orderBy(desc(schema.receipts.createdAt))
          .limit(300),
      );
      return c.json(
        {
          receipts: rows.map(({ receipt, name }) => ({
            id: receipt.id,
            status: receipt.status,
            reason: receipt.reason,
            toolId: receipt.toolId,
            plan: receipt.plan,
            amount: receipt.originalAmount,
            currency: receipt.currency,
            occurredOn: receipt.occurredOn,
            via: receipt.via,
            trust: receipt.trust,
            senderDomain: receipt.senderDomain,
            submittedBy: receipt.submittedBy === null ? null : { id: receipt.submittedBy, name: name ?? '' },
            createdAt: receipt.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'receipts.review' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/receipts/{receiptId}/resolve',
      tags: ['receipts'],
      summary: 'Import a receipt from the review queue (correcting what didn’t parse) or dismiss it',
      request: {
        params: OrgParams.extend({ receiptId: z.uuid().openapi({ param: { name: 'receiptId', in: 'path' } }) }),
        ...jsonBody(
          z.object({
            action: z.enum(['import', 'dismiss']),
            toolId: z.string().max(60).optional(),
            plan: z.string().max(60).nullable().optional(),
            amount: z
              .string()
              .regex(/^\d{1,12}(\.\d{1,6})?$/)
              .optional(),
            currency: z
              .string()
              .regex(/^[A-Za-z]{3}$/)
              .optional(),
            occurredOn: z.iso.date().optional(),
            userId: z.string().max(100).nullable().optional(),
            oneOff: z.boolean().default(false),
          }),
        ),
      },
      responses: { 200: json(z.object({ id: z.uuid(), status: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, receiptId } = c.req.valid('param');
      const body = c.req.valid('json');
      const status = await withOrg(deps.db, orgId, async (tx) => {
        const [receipt] = await tx
          .select()
          .from(schema.receipts)
          .where(
            and(
              eq(schema.receipts.id, receiptId),
              eq(schema.receipts.orgId, orgId),
              eq(schema.receipts.status, 'review'),
            ),
          );
        if (!receipt) throw notFound('receipt in review');
        if (body.action === 'dismiss') {
          await tx
            .update(schema.receipts)
            .set({ status: 'dismissed', resolvedBy: user.id, resolvedAt: new Date() })
            .where(eq(schema.receipts.id, receiptId));
          await auditByUser(tx, {
            orgId,
            userId: user.id,
            action: 'receipt.dismissed',
            subject: `receipt:${receiptId}`,
          });
          return 'dismissed';
        }
        const toolId = body.toolId ?? receipt.toolId;
        const amount = body.amount ?? receipt.originalAmount;
        const currency = (body.currency ?? receipt.currency)?.toUpperCase() ?? null;
        const occurredOn = body.occurredOn ?? receipt.occurredOn;
        const tool = toolId === null ? undefined : toolById(toolId);
        if (tool === undefined || amount === null || currency === null || occurredOn === null)
          throw new AppError(400, 'incomplete_receipt', 'set the tool, amount, currency, and date');
        const amountMicros = await convertToMicros(tx, amount, currency, occurredOn);
        if (amountMicros === null) throw new AppError(400, 'no_exchange_rate', `no exchange rate for ${currency}`);
        const userId = body.userId === undefined ? receipt.submittedBy : body.userId;
        if (userId !== null) await assertMember(tx, orgId, userId);
        const plan = body.plan === undefined ? receipt.plan : body.plan;
        const links = await importParsedReceipt(tx, {
          orgId,
          receiptId,
          userId,
          messageHash: receipt.messageHash,
          amountMicros,
          parsed: {
            status: 'imported',
            reason: null,
            toolId: tool.id,
            vendorDomain: receipt.senderDomain,
            plan,
            amount,
            currency,
            occurredOn,
            renewsOn: receipt.renewsOn,
            trust: 'member',
            oneOff: body.oneOff,
          },
        });
        await tx
          .update(schema.receipts)
          .set({
            status: 'imported',
            toolId: tool.id,
            plan,
            amount: amountMicros,
            originalAmount: amount,
            currency,
            occurredOn,
            seatId: links.seatId,
            externalSpendId: links.externalSpendId,
            resolvedBy: user.id,
            resolvedAt: new Date(),
          })
          .where(eq(schema.receipts.id, receiptId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'receipt.imported',
          subject: `receipt:${receiptId}`,
          data: { toolId: tool.id, amount, currency },
        });
        return 'imported';
      });
      return c.json({ id: receiptId, status }, 200);
    },
  );
}

async function assertMember(tx: Transaction, orgId: string, userId: string) {
  const [member] = await tx
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(and(eq(schema.members.orgId, orgId), eq(schema.members.userId, userId)));
  if (!member) throw new AppError(400, 'not_a_member', 'that person is not a member of this organization');
}
