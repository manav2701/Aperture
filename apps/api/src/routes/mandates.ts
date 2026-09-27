import { PERIODS, formatUsd, micros } from '@aperture/core';
import {
  and,
  budgetNodeRemaining,
  desc,
  eq,
  issueMandate,
  orgJwks,
  revokeMandate,
  rotateSigningKey,
  schema,
  sql,
  withOrg,
  type MandateRow,
  type Transaction,
} from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps, Membership } from '../http/context';
import { AppError, forbidden, notFound } from '../http/errors';
import { reachOf } from '../http/scope';
import { OrgParams, Timestamp, UsdSchema, errorResponses, json, jsonBody } from '../http/schemas';

/*
 * Mandates (plan/architecture §10): scoped, signed spending authority for agents. People issue
 * root mandates here; agents delegate narrower ones to sub-agents through the gateway
 * (/v1/subagents). Revoking cascades to everything delegated below.
 */

const MandateSchema = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    subject: z.object({ id: z.uuid(), name: z.string(), kind: z.enum(['user', 'agent']) }),
    issuedBy: z.string().nullable(),
    purpose: z.string(),
    status: z.enum(['active', 'revoked']),
    scope: z.record(z.string(), z.unknown()),
    uses: z.number().int(),
    maxUses: z.number().int().nullable(),
    remaining: z.union([UsdSchema, z.null()]),
    approvalId: z.uuid().nullable(),
    notBefore: Timestamp,
    expiresAt: Timestamp,
    revokedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    jws: z.string(),
  })
  .openapi('Mandate');

const MandateParams = OrgParams.extend({
  mandateId: z.uuid().openapi({ param: { name: 'mandateId', in: 'path' } }),
});

const JwksSchema = z
  .object({
    keys: z.array(
      z.object({ kty: z.string(), crv: z.string(), x: z.string(), kid: z.string(), alg: z.string(), use: z.string() }),
    ),
  })
  .openapi('Jwks');

type Principal = typeof schema.principals.$inferSelect;

async function view(tx: Transaction, orgId: string, mandate: MandateRow, subject: Principal) {
  const left = mandate.budgetId === null ? null : await budgetNodeRemaining(tx, orgId, mandate.budgetId);
  return {
    id: mandate.id,
    parentId: mandate.parentId,
    subject: { id: subject.id, name: subject.name, kind: subject.kind },
    issuedBy:
      mandate.issuerUserId ?? (mandate.issuerPrincipalId === null ? null : `agent:${mandate.issuerPrincipalId}`),
    purpose: mandate.purpose,
    status: mandate.status,
    scope: mandate.scope,
    uses: mandate.uses,
    maxUses: mandate.maxUses,
    remaining: left === null ? null : formatUsd(micros(left)),
    approvalId: mandate.approvalId,
    notBefore: mandate.notBefore.toISOString(),
    expiresAt: mandate.expiresAt.toISOString(),
    revokedAt: mandate.revokedAt?.toISOString() ?? null,
    createdAt: mandate.createdAt.toISOString(),
    jws: mandate.jws,
  };
}

function assertCanManage(membership: Membership, principal: Pick<Principal, 'teamId'>) {
  const reach = reachOf(membership, 'agents.manage');
  if (reach.kind === 'team' && principal.teamId !== reach.teamId) {
    throw forbidden('you can only manage mandates for your team');
  }
}

async function loadPrincipal(tx: Transaction, orgId: string, principalId: string): Promise<Principal> {
  const [row] = await tx
    .select()
    .from(schema.principals)
    .where(and(eq(schema.principals.id, principalId), eq(schema.principals.orgId, orgId)));
  if (row?.systemRole !== null) throw notFound('principal');
  return row;
}

export function registerMandateRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'agents.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/mandates',
      tags: ['mandates'],
      summary: 'Mandates, newest first; the delegation tree is parentId → id',
      request: {
        params: OrgParams,
        query: z.object({ principalId: z.uuid().optional(), includeRevoked: z.enum(['true', 'false']).optional() }),
      },
      responses: { 200: json(z.object({ mandates: z.array(MandateSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const query = c.req.valid('query');
      const mandates = await withOrg(deps.db, orgId, async (tx) => {
        const rows = await tx
          .select({ mandate: schema.mandates, subject: schema.principals })
          .from(schema.mandates)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.mandates.subjectPrincipalId))
          .where(
            and(
              eq(schema.mandates.orgId, orgId),
              query.principalId === undefined ? undefined : eq(schema.mandates.subjectPrincipalId, query.principalId),
              query.includeRevoked === 'true' ? undefined : eq(schema.mandates.status, 'active'),
            ),
          )
          .orderBy(desc(schema.mandates.createdAt))
          .limit(500);
        return Promise.all(rows.map((row) => view(tx, orgId, row.mandate, row.subject)));
      });
      return c.json({ mandates }, 200);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/agents/{principalId}/mandates',
      tags: ['mandates'],
      summary: 'Issue a standing mandate to an agent (it then acts only within it)',
      request: {
        params: OrgParams.extend({ principalId: z.uuid().openapi({ param: { name: 'principalId', in: 'path' } }) }),
        ...jsonBody(
          z.object({
            purpose: z.string().trim().min(1).max(500),
            budget: z.object({ limit: UsdSchema, period: z.enum(PERIODS) }),
            providers: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
            models: z.array(z.string().min(1).max(200)).min(1).max(50).optional(),
            maxPerAction: UsdSchema.optional(),
            maxUses: z.number().int().min(1).optional(),
            validDays: z.number().int().min(1).max(365).default(30),
          }),
        ),
      },
      responses: { 201: json(MandateSchema, 'Created'), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, principalId } = c.req.valid('param');
      const body = c.req.valid('json');
      const created = await withOrg(deps.db, orgId, async (tx) => {
        const principal = await loadPrincipal(tx, orgId, principalId);
        if (principal.kind !== 'agent') throw new AppError(400, 'not_an_agent', 'mandates are for agents');
        assertCanManage(c.var.membership, principal);
        const [clock] = (await tx.execute<{ now: string }>(sql`select now() as now`)).rows;
        // Database time (P5), so the mandate is valid the moment it is issued.
        const now = clock === undefined ? new Date() : new Date(clock.now);
        const mandate = await issueMandate(tx, deps.ring, {
          orgId,
          subjectPrincipalId: principalId,
          issuerUserId: user.id,
          scope: {
            rails: ['gateway'],
            ...(body.providers === undefined ? {} : { providers: body.providers }),
            ...(body.models === undefined ? {} : { models: body.models }),
            ...(body.maxPerAction === undefined ? {} : { maxPerAction: body.maxPerAction }),
            budget: body.budget,
            notBefore: now.toISOString(),
            expiresAt: new Date(now.getTime() + body.validDays * 86_400_000).toISOString(),
            ...(body.maxUses === undefined ? {} : { maxUses: body.maxUses }),
            purpose: body.purpose,
          },
        });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'mandate.issued',
          subject: `mandate:${mandate.id}`,
          data: { principalId, budget: body.budget.limit, period: body.budget.period, purpose: body.purpose },
        });
        return view(tx, orgId, mandate, principal);
      });
      return c.json(created, 201);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/mandates/{mandateId}/revoke',
      tags: ['mandates'],
      summary: 'Revoke a mandate and everything delegated from it; sub-agents lose their keys',
      request: { params: MandateParams },
      responses: { 200: json(z.object({ revoked: z.number().int() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, mandateId } = c.req.valid('param');
      const revoked = await withOrg(deps.db, orgId, async (tx) => {
        const [row] = await tx
          .select({ mandate: schema.mandates, subject: schema.principals })
          .from(schema.mandates)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.mandates.subjectPrincipalId))
          .where(and(eq(schema.mandates.id, mandateId), eq(schema.mandates.orgId, orgId)));
        if (!row) throw notFound('mandate');
        assertCanManage(c.var.membership, row.subject);
        const count = await revokeMandate(tx, { orgId, mandateId });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'mandate.revoked',
          subject: `mandate:${mandateId}`,
          data: { cascade: count },
        });
        return count;
      });
      return c.json({ revoked }, 200);
    },
  );

  router.add(
    { permission: 'agents.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/mandates/{mandateId}/jws',
      tags: ['mandates'],
      summary: 'The signed mandate (compact JWS), for `pnpm mandate-verify` or any JOSE library',
      request: { params: MandateParams },
      responses: {
        200: { description: 'OK', content: { 'application/jose': { schema: z.string() } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId, mandateId } = c.req.valid('param');
      const [row] = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ jws: schema.mandates.jws })
          .from(schema.mandates)
          .where(and(eq(schema.mandates.id, mandateId), eq(schema.mandates.orgId, orgId))),
      );
      if (!row) throw notFound('mandate');
      return c.body(row.jws, 200, { 'content-type': 'application/jose' });
    },
  );

  router.add(
    { permission: 'org.update' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/signing-keys/rotate',
      tags: ['mandates'],
      summary: 'Sign new mandates with a new key; mandates signed before keep verifying',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ kid: z.string() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const kid = await withOrg(deps.db, orgId, async (tx) => {
        const next = await rotateSigningKey(tx, deps.ring, orgId);
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'signing_key.rotated',
          subject: `org:${orgId}`,
          data: { kid: next },
        });
        return next;
      });
      return c.json({ kid }, 200);
    },
  );

  router.add(
    'public',
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/jwks.json',
      tags: ['mandates'],
      summary: 'Public keys that verify this org’s mandates (also at /.well-known/aperture/orgs/{orgId}/jwks.json)',
      request: { params: OrgParams },
      responses: { 200: json(JwksSchema), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const jwks = await withOrg(deps.db, orgId, (tx) => orgJwks(tx, orgId));
      c.header('cache-control', 'public, max-age=300');
      return c.json(jwks, 200);
    },
  );
}
