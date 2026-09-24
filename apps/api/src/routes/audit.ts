import { verifyChain } from '@aperture/crypto';
import { and, auditRoot, desc, eq, exportAuditEvents, lt, schema, withOrg } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { OrgParams, Timestamp, errorResponses, json } from '../http/schemas';

const AuditEventSchema = z
  .object({
    seq: z.number().int(),
    id: z.uuid(),
    occurredAt: Timestamp,
    actor: z.string(),
    action: z.string(),
    subject: z.string(),
    data: z.unknown(),
    hash: z.string(),
  })
  .openapi('AuditEvent');

const PAGE_SIZE = 50;

export function registerAuditRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'audit.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/audit',
      tags: ['audit'],
      summary: 'Audit events, newest first; pass `before` (a seq) for the next page',
      request: {
        params: OrgParams,
        query: z.object({
          before: z.coerce.number().int().min(1).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(PAGE_SIZE),
        }),
      },
      responses: {
        200: json(z.object({ events: z.array(AuditEventSchema), nextBefore: z.number().int().nullable() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { before, limit } = c.req.valid('query');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.orgId, orgId),
              before === undefined ? undefined : lt(schema.auditEvents.seq, before),
            ),
          )
          .orderBy(desc(schema.auditEvents.seq))
          .limit(limit),
      );
      const last = rows.at(-1);
      return c.json(
        {
          events: rows.map((row) => ({
            seq: row.seq,
            id: row.id,
            occurredAt: row.occurredAt.toISOString(),
            actor: row.actor,
            action: row.action,
            subject: row.subject,
            data: row.data,
            hash: row.hash,
          })),
          nextBefore: rows.length === limit && last !== undefined && last.seq > 1 ? last.seq : null,
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'audit.export' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/audit/export',
      tags: ['audit'],
      summary: 'The hash chain as JSON lines, verifiable offline with `pnpm audit-verify`',
      request: {
        params: OrgParams,
        query: z.object({
          fromSeq: z.coerce.number().int().min(1).optional(),
          toSeq: z.coerce.number().int().min(1).optional(),
        }),
      },
      responses: {
        200: { description: 'One chain record per line', content: { 'application/x-ndjson': { schema: z.string() } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const query = c.req.valid('query');
      const range = {
        ...(query.fromSeq === undefined ? {} : { fromSeq: query.fromSeq }),
        ...(query.toSeq === undefined ? {} : { toSeq: query.toSeq }),
      };
      const records = await withOrg(deps.db, orgId, async (tx) => {
        const exported = await exportAuditEvents(tx, orgId, range);
        // Recorded after reading, so the export itself shows up in the next one.
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'audit.exported',
          subject: `org:${orgId}`,
          data: { records: exported.length, ...range },
        });
        return exported;
      });
      const lines = records.map((record) => JSON.stringify(record)).join('\n');
      const response = c.body(records.length === 0 ? '' : `${lines}\n`, 200, {
        'content-type': 'application/x-ndjson',
        'content-disposition': `attachment; filename="aperture-audit-${orgId}.jsonl"`,
      });
      // @hono/zod-openapi only types JSON and text/plain bodies; other media types resolve to never.
      return response as never;
    },
  );

  router.add(
    { permission: 'audit.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/audit/verify',
      tags: ['audit'],
      summary: 'Re-verifies the whole chain server-side and returns its Merkle root',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            ok: z.boolean(),
            records: z.number().int(),
            root: z.string().nullable(),
            failure: z.object({ seq: z.number().int(), reason: z.string() }).nullable(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const records = await withOrg(deps.db, orgId, (tx) => exportAuditEvents(tx, orgId));
      const result = verifyChain(records);
      return c.json(
        {
          ok: result.ok,
          records: records.length,
          root: records.length === 0 ? null : auditRoot(records),
          failure: result.ok ? null : { seq: result.seq, reason: result.reason },
        },
        200,
      );
    },
  );
}
