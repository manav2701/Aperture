import { formatUsd, micros } from '@aperture/core';
import { and, desc, eq, lt, schema, sql, withOrg } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import type { Router } from '../http/access';
import type { AppDeps } from '../http/context';
import { AppError } from '../http/errors';
import { OrgParams, Timestamp, errorResponses, json } from '../http/schemas';

/** Ledger kinds that move money out; refunds count negatively. Holds and releases are not spend. */
const SPEND_KINDS = sql`('capture', 'unheld_capture', 'observed', 'adjustment', 'refund')`;
const signed = sql`case when e.kind = 'refund' then -e.amount else e.amount end`;
const usd = (value: bigint) => formatUsd(micros(value));

const GroupBy = z.enum(['principal', 'day', 'provider', 'rail']);

export function registerSpendRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'spend.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/spend',
      tags: ['spend'],
      summary: 'Spend totals for a time range, grouped by person/agent, day, provider or rail',
      request: {
        params: OrgParams,
        query: z.object({
          from: z.iso.datetime({ offset: true }).optional(),
          to: z.iso.datetime({ offset: true }).optional(),
          groupBy: GroupBy.default('principal'),
        }),
      },
      responses: {
        200: json(
          z.object({
            from: Timestamp,
            to: Timestamp,
            total: z.string(),
            groups: z.array(z.object({ key: z.string(), label: z.string(), amount: z.string() })),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const query = c.req.valid('query');
      const to = query.to === undefined ? new Date() : new Date(query.to);
      const from = query.from === undefined ? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000) : new Date(query.from);
      if (from >= to) throw new AppError(400, 'invalid_range', '"from" must be before "to"');

      const rows = await withOrg(deps.db, orgId, async (tx) => {
        const [org] = await tx
          .select({ timezone: schema.orgs.timezone })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, orgId));
        const zone = org?.timezone ?? 'UTC';
        const key =
          query.groupBy === 'principal'
            ? sql`e.principal_id::text`
            : query.groupBy === 'day'
              ? sql`to_char(e.occurred_at at time zone ${zone}, 'YYYY-MM-DD')`
              : query.groupBy === 'provider'
                ? sql`coalesce(e.meta->>'provider', split_part(e.resource, ':', 1), e.rail)`
                : sql`e.rail`;
        const label = query.groupBy === 'principal' ? sql`max(p.name)` : sql`''`;
        const result = await tx.execute<{ key: string; label: string; amount: string }>(sql`
          select ${key} as key, ${label} as label, sum(${signed})::text as amount
          from ledger_entries e left join principals p on p.id = e.principal_id
          where e.org_id = ${orgId} and e.kind in ${SPEND_KINDS}
            and e.occurred_at >= ${from.toISOString()} and e.occurred_at < ${to.toISOString()}
          group by 1 order by ${query.groupBy === 'day' ? sql`1` : sql`3 desc`}`);
        return result.rows;
      });
      const total = rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
      return c.json(
        {
          from: from.toISOString(),
          to: to.toISOString(),
          total: usd(total),
          groups: rows.map((row) => ({
            key: row.key,
            label: row.label === '' ? row.key : row.label,
            amount: usd(BigInt(row.amount)),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'spend.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/spend/entries',
      tags: ['spend'],
      summary: 'Individual spend entries, newest first',
      request: {
        params: OrgParams,
        query: z.object({
          before: z.iso.datetime({ offset: true }).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
      responses: {
        200: json(
          z.object({
            entries: z.array(
              z.object({
                id: z.uuid(),
                occurredAt: Timestamp,
                kind: z.string(),
                rail: z.string(),
                amount: z.string(),
                principal: z.object({ id: z.uuid(), name: z.string() }),
                provider: z.string().nullable(),
                model: z.string().nullable(),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { before, limit } = c.req.valid('query');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ entry: schema.ledgerEntries, principalName: schema.principals.name })
          .from(schema.ledgerEntries)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.ledgerEntries.principalId))
          .where(
            and(
              eq(schema.ledgerEntries.orgId, orgId),
              sql`${schema.ledgerEntries.kind} in ${SPEND_KINDS}`,
              before === undefined ? undefined : lt(schema.ledgerEntries.occurredAt, new Date(before)),
            ),
          )
          .orderBy(desc(schema.ledgerEntries.occurredAt))
          .limit(limit),
      );
      return c.json(
        {
          entries: rows.map(({ entry, principalName }) => {
            const meta = entry.meta as { provider?: unknown; model?: unknown };
            // Gateway entries carry "provider:model" in `resource`.
            const [resourceProvider = '', resourceModel = ''] = (entry.resource ?? '').split(':');
            const orNull = (value: string) => (value === '' ? null : value);
            return {
              id: entry.id,
              occurredAt: entry.occurredAt.toISOString(),
              kind: entry.kind,
              rail: entry.rail,
              amount: usd(entry.kind === 'refund' ? -entry.amount : entry.amount),
              principal: { id: entry.principalId, name: principalName },
              provider: typeof meta.provider === 'string' ? meta.provider : orNull(resourceProvider),
              model: typeof meta.model === 'string' ? meta.model : orNull(resourceModel),
            };
          }),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'spend.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/gateway/requests',
      tags: ['spend'],
      summary: 'Gateway requests with their decision, cost and latency (metadata only)',
      request: {
        params: OrgParams,
        query: z.object({
          before: z.iso.datetime({ offset: true }).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
      responses: {
        200: json(
          z.object({
            requests: z.array(
              z.object({
                id: z.uuid(),
                createdAt: Timestamp,
                principal: z.object({ id: z.uuid(), name: z.string() }),
                provider: z.string(),
                model: z.string().nullable(),
                outcome: z.string(),
                reasons: z.unknown(),
                status: z.number().nullable(),
                cost: z.string().nullable(),
                inputTokens: z.number().nullable(),
                outputTokens: z.number().nullable(),
                latencyMs: z.number().nullable(),
                stream: z.boolean(),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { before, limit } = c.req.valid('query');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ request: schema.gatewayRequests, principalName: schema.principals.name })
          .from(schema.gatewayRequests)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.gatewayRequests.principalId))
          .where(
            and(
              eq(schema.gatewayRequests.orgId, orgId),
              before === undefined ? undefined : lt(schema.gatewayRequests.createdAt, new Date(before)),
            ),
          )
          .orderBy(desc(schema.gatewayRequests.createdAt))
          .limit(limit),
      );
      return c.json(
        {
          requests: rows.map(({ request, principalName }) => ({
            id: request.id,
            createdAt: request.createdAt.toISOString(),
            principal: { id: request.principalId, name: principalName },
            provider: request.provider,
            model: request.model,
            outcome: request.outcome,
            reasons: request.reasons,
            status: request.status,
            cost: request.cost === null ? null : usd(request.cost),
            inputTokens: request.inputTokens,
            outputTokens: request.outputTokens,
            latencyMs: request.latencyMs,
            stream: request.stream,
          })),
        },
        200,
      );
    },
  );
}
