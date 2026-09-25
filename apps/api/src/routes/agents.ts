import { PERIODS, can, formatUsd, micros, parseUsd } from '@aperture/core';
import { API_KEY_PREFIX_LENGTH, generateApiKey, hashApiKey, signWorkspaceToken } from '@aperture/crypto';
import {
  and,
  asc,
  budgetHeadroom,
  createBudget,
  desc,
  eq,
  inArray,
  isNull,
  schema,
  withOrg,
  type Transaction,
} from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps, Membership } from '../http/context';
import { AppError, forbidden, notFound } from '../http/errors';
import { reachOf } from '../http/scope';
import { OrgParams, Timestamp, UsdSchema, errorResponses, json, jsonBody } from '../http/schemas';

const AgentSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(['active', 'paused', 'revoked']),
    teamId: z.uuid().nullable(),
    owner: z.object({ id: z.string(), name: z.string() }).nullable(),
    activeKeys: z.number().int(),
    createdAt: Timestamp,
  })
  .openapi('Agent');

const KeySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    prefix: z.string(),
    principal: z.object({ id: z.uuid(), name: z.string(), kind: z.enum(['user', 'agent']) }),
    expiresAt: Timestamp.nullable(),
    revokedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi('ApiKey');

const PrincipalParams = OrgParams.extend({
  principalId: z.uuid().openapi({ param: { name: 'principalId', in: 'path' } }),
});
const KeyParams = OrgParams.extend({ keyId: z.uuid().openapi({ param: { name: 'keyId', in: 'path' } }) });
const NewKeyBody = z.object({
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
const WORKSPACE_TOKEN_SECONDS = 300;

type PrincipalRow = typeof schema.principals.$inferSelect;

async function loadPrincipal(tx: Transaction, orgId: string, principalId: string): Promise<PrincipalRow> {
  const [row] = await tx
    .select()
    .from(schema.principals)
    .where(and(eq(schema.principals.id, principalId), eq(schema.principals.orgId, orgId)));
  if (row?.systemRole !== null) throw notFound('principal');
  return row;
}

/** Team leads manage agents in their own team only. */
function assertCanManageAgent(membership: Membership, agent: Pick<PrincipalRow, 'kind' | 'teamId'>) {
  if (agent.kind !== 'agent') throw new AppError(400, 'not_an_agent', 'this is a person, not an agent');
  const reach = reachOf(membership, 'agents.manage');
  if (reach.kind === 'team' && agent.teamId !== reach.teamId)
    throw forbidden('you can only manage agents in your team');
}

async function myPrincipal(tx: Transaction, orgId: string, userId: string): Promise<PrincipalRow> {
  const [row] = await tx
    .select()
    .from(schema.principals)
    .where(and(eq(schema.principals.orgId, orgId), eq(schema.principals.userId, userId)));
  if (!row) throw notFound('principal');
  return row;
}

async function issueKey(
  deps: AppDeps,
  tx: Transaction,
  input: { orgId: string; principalId: string; name: string; userId: string; expiresInDays?: number | undefined },
) {
  const { key, prefix } = generateApiKey(process.env.NODE_ENV === 'production' ? 'live' : 'test');
  const expiresAt = input.expiresInDays === undefined ? null : new Date(Date.now() + input.expiresInDays * 86_400_000);
  const [row] = await tx
    .insert(schema.apiKeys)
    .values({
      id: uuidv7(),
      orgId: input.orgId,
      principalId: input.principalId,
      name: input.name,
      prefix: prefix.slice(0, API_KEY_PREFIX_LENGTH),
      hash: hashApiKey(key, deps.pepper),
      createdBy: input.userId,
      expiresAt,
    })
    .returning();
  if (!row) throw new Error('insert returned no row');
  await auditByUser(tx, {
    orgId: input.orgId,
    userId: input.userId,
    action: 'api_key.created',
    subject: `api_key:${row.id}`,
    data: { principalId: input.principalId, prefix: row.prefix },
  });
  return { row, key };
}

export function registerAgentRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'agents.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/agents',
      tags: ['agents'],
      request: { params: OrgParams },
      responses: { 200: json(z.object({ agents: z.array(AgentSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const agents = await withOrg(deps.db, orgId, async (tx) => {
        const rows = await tx
          .select({ agent: schema.principals, ownerName: schema.users.name })
          .from(schema.principals)
          .leftJoin(schema.users, eq(schema.users.id, schema.principals.ownerUserId))
          .where(
            and(
              eq(schema.principals.orgId, orgId),
              eq(schema.principals.kind, 'agent'),
              isNull(schema.principals.systemRole),
            ),
          )
          .orderBy(asc(schema.principals.name));
        const keys = await tx
          .select({ principalId: schema.apiKeys.principalId })
          .from(schema.apiKeys)
          .where(and(eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt)));
        return rows.map(({ agent, ownerName }) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          status: agent.status,
          teamId: agent.teamId,
          owner: agent.ownerUserId === null ? null : { id: agent.ownerUserId, name: ownerName ?? '' },
          activeKeys: keys.filter((key) => key.principalId === agent.id).length,
          createdAt: agent.createdAt.toISOString(),
        }));
      });
      return c.json({ agents }, 200);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/agents',
      tags: ['agents'],
      summary: 'Create an agent, optionally with its own budget under its team’s (or the org’s) budget',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            name: z.string().trim().min(1).max(80),
            description: z.string().trim().max(500).optional(),
            teamId: z.uuid().nullable().optional(),
            budget: z
              .object({ limit: UsdSchema, period: z.enum(PERIODS), mode: z.enum(['hard', 'soft']).default('hard') })
              .optional(),
          }),
        ),
      },
      responses: { 201: json(AgentSchema, 'Created'), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const teamId = body.teamId ?? null;
      assertCanManageAgent(c.var.membership, { kind: 'agent', teamId });
      const agent = await withOrg(deps.db, orgId, async (tx) => {
        if (teamId !== null) {
          const [team] = await tx.select({ id: schema.teams.id }).from(schema.teams).where(eq(schema.teams.id, teamId));
          if (!team) throw new AppError(400, 'invalid_team', 'that team does not exist in this organization');
        }
        const [created] = await tx
          .insert(schema.principals)
          .values({
            id: uuidv7(),
            orgId,
            kind: 'agent',
            name: body.name,
            description: body.description ?? null,
            teamId,
            ownerUserId: user.id,
          })
          .returning();
        if (!created) throw new Error('insert returned no row');
        if (body.budget !== undefined) {
          const parents = await tx
            .select()
            .from(schema.budgets)
            .where(
              and(
                eq(schema.budgets.orgId, orgId),
                isNull(schema.budgets.archivedAt),
                inArray(schema.budgets.scope, ['team', 'org']),
              ),
            )
            .orderBy(asc(schema.budgets.createdAt));
          const parent =
            parents.find((b) => b.scope === 'team' && b.scopeId === teamId) ??
            parents.find((b) => b.scope === 'org' && b.parentId === null);
          await createBudget(tx, {
            orgId,
            name: `${body.name} (${body.budget.period === 'none' ? 'total' : `per ${body.budget.period}`})`,
            parentId: parent?.id,
            scope: 'principal',
            scopeId: created.id,
            period: body.budget.period,
            limit: parseUsd(body.budget.limit),
            mode: body.budget.mode,
          });
        }
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'agent.created',
          subject: `principal:${created.id}`,
          data: { name: body.name, teamId, budget: body.budget?.limit ?? 'inherited' },
        });
        return created;
      });
      return c.json(
        {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          status: agent.status,
          teamId: agent.teamId,
          owner: { id: user.id, name: user.name },
          activeKeys: 0,
          createdAt: agent.createdAt.toISOString(),
        },
        201,
      );
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/principals/{principalId}/status',
      tags: ['agents'],
      summary: 'Kill switch: pause, resume or revoke an agent (people are paused through members.manage)',
      description: 'Takes effect on the next gateway request: reservations read the status fresh.',
      request: { params: PrincipalParams, ...jsonBody(z.object({ status: z.enum(['active', 'paused', 'revoked']) })) },
      responses: { 204: { description: 'Updated' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, principalId } = c.req.valid('param');
      const { status } = c.req.valid('json');
      await withOrg(deps.db, orgId, async (tx) => {
        const principal = await loadPrincipal(tx, orgId, principalId);
        if (principal.kind === 'user') {
          if (!can(c.var.membership.role, 'members.manage')) throw forbidden('pausing a person needs members.manage');
        } else {
          assertCanManageAgent(c.var.membership, principal);
        }
        if (principal.status === 'revoked' && status !== 'revoked')
          throw new AppError(409, 'revoked', 'a revoked principal can’t be reactivated');
        await tx.update(schema.principals).set({ status }).where(eq(schema.principals.id, principalId));
        if (status === 'revoked') {
          await tx
            .update(schema.apiKeys)
            .set({ revokedAt: new Date() })
            .where(and(eq(schema.apiKeys.principalId, principalId), isNull(schema.apiKeys.revokedAt)));
        }
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: `principal.${status === 'active' ? 'resumed' : status}`,
          subject: `principal:${principalId}`,
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/agents/pause-all',
      tags: ['agents'],
      summary: 'Emergency stop: pause every active agent in the organization',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ paused: z.number().int() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      if (reachOf(c.var.membership, 'agents.manage').kind !== 'all')
        throw forbidden('only admins can pause every agent');
      const paused = await withOrg(deps.db, orgId, async (tx) => {
        const rows = await tx
          .update(schema.principals)
          .set({ status: 'paused' })
          .where(
            and(
              eq(schema.principals.orgId, orgId),
              eq(schema.principals.kind, 'agent'),
              eq(schema.principals.status, 'active'),
              isNull(schema.principals.systemRole),
            ),
          )
          .returning({ id: schema.principals.id });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'agents.paused_all',
          subject: `org:${orgId}`,
          data: { count: rows.length },
        });
        return rows.length;
      });
      return c.json({ paused }, 200);
    },
  );

  router.add(
    { permission: 'agents.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/keys',
      tags: ['agents'],
      summary: 'Gateway keys (only a prefix is ever shown again)',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ keys: z.array(KeySchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({
            key: schema.apiKeys,
            principal: { id: schema.principals.id, name: schema.principals.name, kind: schema.principals.kind },
          })
          .from(schema.apiKeys)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.apiKeys.principalId))
          .where(eq(schema.apiKeys.orgId, orgId))
          .orderBy(desc(schema.apiKeys.createdAt)),
      );
      return c.json(
        {
          keys: rows.map(({ key, principal }) => ({
            id: key.id,
            name: key.name,
            prefix: key.prefix,
            principal,
            expiresAt: key.expiresAt?.toISOString() ?? null,
            revokedAt: key.revokedAt?.toISOString() ?? null,
            createdAt: key.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/principals/{principalId}/keys',
      tags: ['agents'],
      summary: 'Create a gateway key for an agent (shown once)',
      request: { params: PrincipalParams, ...jsonBody(NewKeyBody) },
      responses: {
        201: json(z.object({ key: z.string(), apiKey: KeySchema }), 'Created — copy the key now'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, principalId } = c.req.valid('param');
      const body = c.req.valid('json');
      const { row, key, principal } = await withOrg(deps.db, orgId, async (tx) => {
        const found = await loadPrincipal(tx, orgId, principalId);
        assertCanManageAgent(c.var.membership, found);
        if (found.status === 'revoked') throw new AppError(409, 'revoked', 'this agent is revoked');
        return {
          ...(await issueKey(deps, tx, {
            orgId,
            principalId,
            name: body.name,
            userId: user.id,
            expiresInDays: body.expiresInDays,
          })),
          principal: found,
        };
      });
      return c.json(
        {
          key,
          apiKey: {
            id: row.id,
            name: row.name,
            prefix: row.prefix,
            principal: { id: principal.id, name: principal.name, kind: principal.kind },
            expiresAt: row.expiresAt?.toISOString() ?? null,
            revokedAt: null,
            createdAt: row.createdAt.toISOString(),
          },
        },
        201,
      );
    },
  );

  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/me/keys',
      tags: ['agents'],
      summary: 'Create a personal gateway key that spends as you (shown once)',
      request: { params: OrgParams, ...jsonBody(NewKeyBody) },
      responses: {
        201: json(z.object({ key: z.string(), prefix: z.string() }), 'Created — copy the key now'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const { row, key } = await withOrg(deps.db, orgId, async (tx) => {
        const principal = await myPrincipal(tx, orgId, user.id);
        return issueKey(deps, tx, {
          orgId,
          principalId: principal.id,
          name: body.name,
          userId: user.id,
          expiresInDays: body.expiresInDays,
        });
      });
      return c.json({ key, prefix: row.prefix }, 201);
    },
  );

  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/keys/{keyId}',
      tags: ['agents'],
      summary: 'Revoke a gateway key (your own, or any key if you manage agents)',
      request: { params: KeyParams },
      responses: { 204: { description: 'Revoked' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, keyId } = c.req.valid('param');
      await withOrg(deps.db, orgId, async (tx) => {
        const [key] = await tx
          .select({ key: schema.apiKeys, principal: schema.principals })
          .from(schema.apiKeys)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.apiKeys.principalId))
          .where(eq(schema.apiKeys.id, keyId));
        if (!key) throw notFound('key');
        const own = key.principal.userId === user.id;
        if (!own) {
          if (!can(c.var.membership.role, 'agents.manage')) throw forbidden('you can only revoke your own keys');
          if (key.principal.kind === 'agent') assertCanManageAgent(c.var.membership, key.principal);
          else if (!can(c.var.membership.role, 'members.manage'))
            throw forbidden('only admins can revoke someone else’s key');
        }
        await tx
          .update(schema.apiKeys)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.apiKeys.id, keyId), isNull(schema.apiKeys.revokedAt)));
        await auditByUser(tx, { orgId, userId: user.id, action: 'api_key.revoked', subject: `api_key:${keyId}` });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/workspace',
      tags: ['workspace'],
      summary: 'What the signed-in person can use in the chat workspace, and their remaining budget',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            available: z.boolean(),
            gatewayUrl: z.string().nullable(),
            remaining: z.string().nullable(),
            budgetName: z.string().nullable(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const headroom = await withOrg(deps.db, orgId, async (tx) => {
        const principal = await myPrincipal(tx, orgId, user.id);
        return budgetHeadroom(tx, { orgId, principalId: principal.id, rail: 'gateway' });
      });
      return c.json(
        {
          available: deps.gateway !== undefined,
          gatewayUrl: deps.gatewayPublicUrl ?? null,
          remaining: headroom.remaining === null ? null : formatUsd(micros(headroom.remaining)),
          budgetName: headroom.budgetName,
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/workspace/chat',
      tags: ['workspace'],
      summary: 'Chat through the gateway as yourself (streams OpenAI-format events); the browser never holds a key',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            model: z.string().min(1).max(200),
            messages: z
              .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(100_000) }))
              .min(1)
              .max(200),
          }),
        ),
      },
      responses: {
        200: { description: 'Server-sent events', content: { 'text/event-stream': { schema: z.string() } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      if (deps.gateway === undefined)
        throw new AppError(503, 'gateway_unavailable', 'the gateway is not enabled on this deployment');
      const principal = await withOrg(deps.db, orgId, (tx) => myPrincipal(tx, orgId, user.id));
      const token = signWorkspaceToken(
        { orgId, principalId: principal.id, exp: Math.floor(Date.now() / 1000) + WORKSPACE_TOKEN_SECONDS },
        deps.pepper,
      );
      const upstream = await deps.gateway.fetch(
        new Request('http://gateway.internal/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: body.model, messages: body.messages, stream: true }),
          signal: c.req.raw.signal,
        }),
      );
      // @hono/zod-openapi only types JSON and text/plain bodies; other media types resolve to never.
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
          'cache-control': 'no-cache',
          'x-aperture-request-id': upstream.headers.get('x-aperture-request-id') ?? '',
        },
      });
    },
  );
}
