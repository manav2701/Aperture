import { createHash } from 'node:crypto';
import { STATEMENT_MAX_ROWS, formatUsd, matchDescriptor, micros, normalizeDescriptor } from '@aperture/core';
import { and, convertToMicros, desc, eq, inArray, schema, withOrg } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, notFound } from '../http/errors';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';

/*
 * Shadow AI from statements (plan/phases/phase-11 §11.4). The browser parses the CSV and sends
 * only rows that match an AI vendor; the server re-validates each row and re-matches it against
 * the catalogue, so a modified client can't plant arbitrary rows. External spend never touches
 * the ledger (INV-16).
 */

const usd = (value: bigint) => formatUsd(micros(value));

const RowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  descriptor: z.string().trim().min(1).max(200),
});

const ExternalSpendSchema = z
  .object({
    id: z.uuid(),
    occurredOn: z.string(),
    amount: z.string(),
    originalAmount: z.string(),
    originalCurrency: z.string(),
    descriptor: z.string(),
    toolId: z.string(),
    vendor: z.string(),
    category: z.string(),
    source: z.enum(['statement_upload', 'receipt']),
    status: z.enum(['open', 'assigned', 'governed', 'dismissed', 'provider_billing']),
    assignedPrincipal: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    assignedTeamId: z.uuid().nullable(),
    connectionId: z.uuid().nullable(),
    note: z.string().nullable(),
    createdAt: Timestamp,
  })
  .openapi('ExternalSpend');

/** Re-uploading the same statement (or an overlapping one) doesn't duplicate rows. */
const dedupeHash = (row: z.infer<typeof RowSchema>) =>
  createHash('sha256')
    .update(`${row.date}|${row.amount}|${row.currency.toUpperCase()}|${normalizeDescriptor(row.descriptor)}`)
    .digest('hex');

export function registerShadowRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'external_spend.import' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/external-spend/uploads',
      tags: ['shadow-ai'],
      summary: 'Import AI charges found on a bank or card statement (matched rows only)',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            fileName: z.string().trim().min(1).max(200),
            rows: z.array(RowSchema).max(STATEMENT_MAX_ROWS),
          }),
        ),
      },
      responses: {
        201: json(
          z.object({
            uploadId: z.uuid(),
            received: z.number().int(),
            inserted: z.number().int(),
            duplicates: z.number().int(),
            providerBilling: z.number().int(),
            unmatched: z.number().int(),
            noRate: z.number().int(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const { fileName, rows } = c.req.valid('json');
      const result = await withOrg(deps.db, orgId, async (tx) => {
        const connected = new Map(
          (
            await tx
              .select({ id: schema.connections.id, provider: schema.connections.provider })
              .from(schema.connections)
              .where(and(eq(schema.connections.orgId, orgId), eq(schema.connections.status, 'active')))
          ).map((row) => [row.provider, row.id]),
        );
        const uploadId = uuidv7();
        await tx
          .insert(schema.statementUploads)
          .values({ id: uploadId, orgId, uploadedBy: user.id, fileName, rowsReceived: rows.length, rowsNew: 0 });
        const counts = { inserted: 0, duplicates: 0, providerBilling: 0, unmatched: 0, noRate: 0 };
        for (const row of rows) {
          const tool = matchDescriptor(row.descriptor);
          if (tool === undefined) {
            counts.unmatched += 1;
            continue;
          }
          const amount = await convertToMicros(tx, row.amount, row.currency, row.date);
          if (amount === null) {
            counts.noRate += 1;
            continue;
          }
          // V12: the invoice for an account Aperture already connects isn't shadow AI.
          const connectionId = tool.apiProvider === undefined ? undefined : connected.get(tool.apiProvider);
          const inserted = await tx
            .insert(schema.externalSpend)
            .values({
              id: uuidv7(),
              orgId,
              occurredOn: row.date,
              amount,
              originalAmount: row.amount,
              originalCurrency: row.currency.toUpperCase(),
              descriptor: row.descriptor,
              toolId: tool.id,
              vendor: tool.vendor,
              category: tool.category,
              source: 'statement_upload',
              uploadId,
              dedupeHash: dedupeHash(row),
              status: connectionId === undefined ? 'open' : 'provider_billing',
              connectionId: connectionId ?? null,
            })
            .onConflictDoNothing()
            .returning({ id: schema.externalSpend.id });
          if (inserted.length === 0) counts.duplicates += 1;
          else {
            counts.inserted += 1;
            if (connectionId !== undefined) counts.providerBilling += 1;
          }
        }
        await tx
          .update(schema.statementUploads)
          .set({ rowsNew: counts.inserted })
          .where(eq(schema.statementUploads.id, uploadId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'external_spend.imported',
          subject: `statement_upload:${uploadId}`,
          data: { fileName, received: rows.length, ...counts },
        });
        return { uploadId, received: rows.length, ...counts };
      });
      return c.json(result, 201);
    },
  );

  router.add(
    { permission: 'inventory.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/external-spend',
      tags: ['shadow-ai'],
      summary: 'AI spend found outside Aperture (statements and one-off receipts), newest first',
      request: {
        params: OrgParams,
        query: z.object({
          status: z.enum(['open', 'assigned', 'governed', 'dismissed', 'provider_billing', 'all']).default('all'),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        }),
      },
      responses: {
        200: json(z.object({ rows: z.array(ExternalSpendSchema), openTotal: z.string() })),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { status, limit } = c.req.valid('query');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ row: schema.externalSpend, principalName: schema.principals.name })
          .from(schema.externalSpend)
          .leftJoin(schema.principals, eq(schema.principals.id, schema.externalSpend.assignedPrincipalId))
          .where(
            and(
              eq(schema.externalSpend.orgId, orgId),
              status === 'all' ? undefined : eq(schema.externalSpend.status, status),
            ),
          )
          .orderBy(desc(schema.externalSpend.occurredOn))
          .limit(limit),
      );
      const openTotal = rows.filter((r) => r.row.status === 'open').reduce((sum, r) => sum + r.row.amount, 0n);
      return c.json(
        {
          rows: rows.map(({ row, principalName }) => ({
            id: row.id,
            occurredOn: row.occurredOn,
            amount: usd(row.amount),
            originalAmount: row.originalAmount,
            originalCurrency: row.originalCurrency,
            descriptor: row.descriptor,
            toolId: row.toolId,
            vendor: row.vendor,
            category: row.category,
            source: row.source,
            status: row.status,
            assignedPrincipal:
              row.assignedPrincipalId === null ? null : { id: row.assignedPrincipalId, name: principalName ?? '' },
            assignedTeamId: row.assignedTeamId,
            connectionId: row.connectionId,
            note: row.note,
            createdAt: row.createdAt.toISOString(),
          })),
          openTotal: usd(openTotal),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'external_spend.import' },
    createRoute({
      method: 'patch',
      path: '/api/v1/orgs/{orgId}/external-spend/{rowId}',
      tags: ['shadow-ai'],
      summary: 'Resolve a found charge: assign it, mark it brought under governance, dismiss it, or reopen it',
      request: {
        params: OrgParams.extend({ rowId: z.uuid().openapi({ param: { name: 'rowId', in: 'path' } }) }),
        ...jsonBody(
          z.object({
            action: z.enum(['assign', 'govern', 'dismiss', 'reopen']),
            principalId: z.uuid().nullable().optional(),
            teamId: z.uuid().nullable().optional(),
            note: z.string().trim().max(500).optional(),
          }),
        ),
      },
      responses: { 200: json(z.object({ id: z.uuid(), status: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, rowId } = c.req.valid('param');
      const body = c.req.valid('json');
      if (body.action === 'dismiss' && (body.note === undefined || body.note.length < 3))
        throw new AppError(400, 'reason_required', 'say why the charge is being dismissed');
      if (body.action === 'assign' && body.principalId == null && body.teamId == null)
        throw new AppError(400, 'assignee_required', 'choose a person, agent, or team');
      const status = { assign: 'assigned', govern: 'governed', dismiss: 'dismissed', reopen: 'open' } as const;
      const updated = await withOrg(deps.db, orgId, async (tx) => {
        if (body.principalId != null) {
          const [principal] = await tx
            .select({ id: schema.principals.id })
            .from(schema.principals)
            .where(and(eq(schema.principals.id, body.principalId), eq(schema.principals.orgId, orgId)));
          if (!principal) throw notFound('principal');
        }
        if (body.teamId != null) {
          const [team] = await tx
            .select({ id: schema.teams.id })
            .from(schema.teams)
            .where(and(eq(schema.teams.id, body.teamId), eq(schema.teams.orgId, orgId)));
          if (!team) throw notFound('team');
        }
        const [row] = await tx
          .update(schema.externalSpend)
          .set({
            status: status[body.action],
            ...(body.action === 'assign'
              ? { assignedPrincipalId: body.principalId ?? null, assignedTeamId: body.teamId ?? null }
              : {}),
            ...(body.note === undefined ? {} : { note: body.note }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.externalSpend.id, rowId),
              eq(schema.externalSpend.orgId, orgId),
              inArray(schema.externalSpend.status, ['open', 'assigned', 'governed', 'dismissed']),
            ),
          )
          .returning();
        if (!row) throw notFound('charge');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'external_spend.resolved',
          subject: `external_spend:${row.id}`,
          data: {
            action: body.action,
            principalId: body.principalId ?? null,
            teamId: body.teamId ?? null,
            note: body.note ?? null,
          },
        });
        return row;
      });
      return c.json({ id: updated.id, status: updated.status }, 200);
    },
  );
}
