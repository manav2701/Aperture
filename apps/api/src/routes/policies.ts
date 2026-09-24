import {
  RAILS,
  evaluatePolicy,
  type ActionInput,
  parseUsd,
  payeeSchema,
  policyDocumentSchema,
  type PolicyLayer,
} from '@aperture/core';
import { and, desc, eq, schema, withOrg, type Transaction } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, forbidden, notFound } from '../http/errors';
import { reachOf, type Reach } from '../http/scope';
import { OrgParams, Timestamp, UsdSchema, errorResponses, json, jsonBody } from '../http/schemas';

const POLICY_SCOPES = ['org', 'team', 'principal'] as const;
type PolicyScope = (typeof POLICY_SCOPES)[number];
type PolicyRow = typeof schema.policies.$inferSelect;

const PolicyDocumentSchema = z
  .object({ rules: z.array(z.record(z.string(), z.unknown())) })
  .openapi('PolicyDocument', { description: 'Rules as stored; see packages/core/src/policy/schema.ts' });

const PolicySchema = z
  .object({
    scope: z.enum(POLICY_SCOPES),
    scopeId: z.uuid(),
    version: z.number().int(),
    document: PolicyDocumentSchema,
    createdBy: z.string(),
    createdAt: Timestamp,
  })
  .openapi('Policy');

const PolicyParams = OrgParams.extend({
  scope: z.enum(POLICY_SCOPES).openapi({ param: { name: 'scope', in: 'path' } }),
  scopeId: z.uuid().openapi({ param: { name: 'scopeId', in: 'path' } }),
});

const ActionSchema = z
  .object({
    rail: z.enum(RAILS),
    amount: UsdSchema,
    provider: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(200).optional(),
    merchant: z
      .object({
        category: z.string().max(100).optional(),
        country: z.string().max(10).optional(),
        name: z.string().max(200).optional(),
      })
      .optional(),
    payee: payeeSchema.optional(),
    media: z
      .object({ videoSeconds: z.number().int().min(0).optional(), images: z.number().int().min(0).optional() })
      .optional(),
  })
  .openapi('SimulatedAction');

const DecisionSchema = z
  .object({
    outcome: z.enum(['allow', 'deny', 'require_approval']),
    reasons: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        ruleId: z.string().optional(),
        level: z.string().optional(),
        scopeId: z.string().optional(),
      }),
    ),
    obligations: z.object({ maxOutputTokens: z.number().optional(), promptLogging: z.string().optional() }),
    layers: z.array(z.object({ level: z.string(), scopeId: z.string(), version: z.number() })),
  })
  .openapi('Decision');

const toPolicy = (row: PolicyRow) => ({
  scope: row.scope,
  scopeId: row.scopeId,
  version: row.version,
  document: row.document as z.infer<typeof PolicyDocumentSchema>,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

async function activePolicy(tx: Transaction, orgId: string, scope: PolicyScope, scopeId: string) {
  const [row] = await tx
    .select()
    .from(schema.policies)
    .where(
      and(eq(schema.policies.orgId, orgId), eq(schema.policies.scope, scope), eq(schema.policies.scopeId, scopeId)),
    )
    .orderBy(desc(schema.policies.version))
    .limit(1);
  return row;
}

/** Checks the scope target exists in the org and, for team leads, that it sits in their team. */
async function assertPolicyTarget(tx: Transaction, orgId: string, scope: PolicyScope, scopeId: string, reach: Reach) {
  if (scope === 'org') {
    if (scopeId !== orgId) throw notFound('policy scope');
    if (reach.kind === 'team') throw forbidden('the org policy is set by finance or an admin');
    return;
  }
  if (scope === 'team') {
    const [team] = await tx
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(and(eq(schema.teams.id, scopeId), eq(schema.teams.orgId, orgId)));
    if (!team) throw notFound('team');
    if (reach.kind === 'team' && reach.teamId !== scopeId)
      throw forbidden('you can only manage your own team’s policies');
    return;
  }
  const [principal] = await tx
    .select({ teamId: schema.principals.teamId })
    .from(schema.principals)
    .where(and(eq(schema.principals.id, scopeId), eq(schema.principals.orgId, orgId)));
  if (!principal) throw notFound('principal');
  if (reach.kind === 'team' && principal.teamId !== reach.teamId) {
    throw forbidden('you can only manage policies of principals in your team');
  }
}

export function registerPolicyRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'policies.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/policies',
      tags: ['policies'],
      summary: 'The active (latest) policy of every scope',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ policies: z.array(PolicySchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .selectDistinctOn([schema.policies.scope, schema.policies.scopeId])
          .from(schema.policies)
          .where(eq(schema.policies.orgId, orgId))
          .orderBy(schema.policies.scope, schema.policies.scopeId, desc(schema.policies.version)),
      );
      return c.json({ policies: rows.map(toPolicy) }, 200);
    },
  );

  router.add(
    { permission: 'policies.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/policies/{scope}/{scopeId}',
      tags: ['policies'],
      summary: 'A scope’s active policy and its version history',
      request: { params: PolicyParams },
      responses: {
        200: json(
          z.object({
            // A union rather than .nullable(): generators read a nullable $ref as an intersection.
            active: z.union([PolicySchema, z.null()]),
            versions: z.array(z.object({ version: z.number().int(), createdBy: z.string(), createdAt: Timestamp })),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId, scope, scopeId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.policies)
          .where(
            and(
              eq(schema.policies.orgId, orgId),
              eq(schema.policies.scope, scope),
              eq(schema.policies.scopeId, scopeId),
            ),
          )
          .orderBy(desc(schema.policies.version)),
      );
      const [latest] = rows;
      return c.json(
        {
          active: latest ? toPolicy(latest) : null,
          versions: rows.map((row) => ({
            version: row.version,
            createdBy: row.createdBy,
            createdAt: row.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'policies.manage' },
    createRoute({
      method: 'put',
      path: '/api/v1/orgs/{orgId}/policies/{scope}/{scopeId}',
      tags: ['policies'],
      summary: 'Publish a new version of a scope’s policy',
      description:
        'Versions are immutable. Pass `expectedVersion` (0 for a scope with no policy yet) to fail with 409 ' +
        'instead of overwriting someone else’s change.',
      request: {
        params: PolicyParams,
        ...jsonBody(z.object({ document: z.unknown(), expectedVersion: z.number().int().min(0).optional() })),
      },
      responses: { 200: json(PolicySchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const reach = reachOf(c.var.membership, 'policies.manage');
      const { orgId, scope, scopeId } = c.req.valid('param');
      const body = c.req.valid('json');
      const parsed = policyDocumentSchema.safeParse(body.document);
      if (!parsed.success)
        throw new AppError(400, 'invalid_policy', 'the policy document is invalid', parsed.error.issues);

      const policy = await withOrg(deps.db, orgId, async (tx) => {
        await assertPolicyTarget(tx, orgId, scope, scopeId, reach);
        const current = await activePolicy(tx, orgId, scope, scopeId);
        const currentVersion = current?.version ?? 0;
        if (body.expectedVersion !== undefined && body.expectedVersion !== currentVersion) {
          throw new AppError(409, 'policy_version_conflict', `the policy is now at version ${String(currentVersion)}`);
        }
        // Concurrent publishers collide on the (org, scope, scopeId, version) unique key.
        const [created] = await tx
          .insert(schema.policies)
          .values({
            id: uuidv7(),
            orgId,
            scope,
            scopeId,
            version: currentVersion + 1,
            document: body.document,
            createdBy: user.id,
          })
          .returning();
        if (!created) throw new Error('insert returned no row');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'policy.published',
          subject: `policy:${scope}:${scopeId}`,
          data: { version: created.version, rules: parsed.data.rules.length },
        });
        return created;
      });
      return c.json(toPolicy(policy), 200);
    },
  );

  router.add(
    { permission: 'policies.read' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/policies/simulate',
      tags: ['policies'],
      summary: 'What would happen if this principal attempted this action now?',
      description:
        'Uses the active org, team and principal policies; `drafts` replace them to test changes before publishing.',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            principalId: z.uuid().optional(),
            teamId: z.uuid().optional(),
            action: ActionSchema,
            drafts: z
              .array(z.object({ scope: z.enum(POLICY_SCOPES), scopeId: z.uuid(), document: z.unknown() }))
              .max(3)
              .default([]),
          }),
        ),
      },
      responses: { 200: json(DecisionSchema), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const decision = await withOrg(deps.db, orgId, async (tx) => {
        const [org] = await tx
          .select({ timezone: schema.orgs.timezone })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, orgId));
        if (!org) throw notFound('organization');

        let teamId = body.teamId;
        if (body.principalId !== undefined) {
          const [principal] = await tx
            .select({ teamId: schema.principals.teamId })
            .from(schema.principals)
            .where(and(eq(schema.principals.id, body.principalId), eq(schema.principals.orgId, orgId)));
          if (!principal) throw notFound('principal');
          teamId ??= principal.teamId ?? undefined;
        }

        const targets: [PolicyScope, string | undefined][] = [
          ['org', orgId],
          ['team', teamId],
          ['principal', body.principalId],
        ];
        const layers: PolicyLayer[] = [];
        for (const [scope, scopeId] of targets) {
          if (scopeId === undefined) continue;
          const draft = body.drafts.find((d) => d.scope === scope && d.scopeId === scopeId);
          if (draft) {
            layers.push({ level: scope, scopeId, version: 0, document: draft.document });
            continue;
          }
          const active = await activePolicy(tx, orgId, scope, scopeId);
          if (active) layers.push({ level: scope, scopeId, version: active.version, document: active.document });
        }

        const { amount, provider, model, merchant, payee, media, rail } = body.action;
        const action: ActionInput = {
          rail,
          amount: parseUsd(amount),
          ...(provider === undefined ? {} : { provider }),
          ...(model === undefined ? {} : { model }),
          ...(merchant === undefined ? {} : { merchant: merchant as NonNullable<ActionInput['merchant']> }),
          ...(payee === undefined ? {} : { payee }),
          ...(media === undefined ? {} : { media: media as NonNullable<ActionInput['media']> }),
        };
        return evaluatePolicy({ action, at: new Date(), timeZone: org.timezone, layers });
      });
      return c.json(decision, 200);
    },
  );
}
