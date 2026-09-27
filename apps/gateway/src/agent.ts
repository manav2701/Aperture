import { PERIODS, evaluatePolicy, formatUsd, mandateToPolicyDocument, micros, parseUsd } from '@aperture/core';
import { API_KEY_PREFIX_LENGTH, generateApiKey, hashApiKey } from '@aperture/crypto';
import {
  MandateError,
  and,
  appendAuditEvent,
  budgetHeadroom,
  budgetNodeRemaining,
  eq,
  inArray,
  issueMandate,
  parseScope,
  requestApproval,
  schema,
  standingMandate,
  withOrg,
} from '@aperture/db';
import type { Hono } from 'hono';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { connectedProviders, loadPrincipalContext, type Caller } from './context';
import { GatewayError, errorResponse } from './errors';
import { admit, type GatewayDeps } from './pipeline';

/*
 * The agent-facing control surface (plan/phases/phase-07 §7.4): what an agent may do, what it
 * has left, asking for approval, delegating to sub-agents, and stopping itself. The SDK and the
 * MCP server are thin clients of these routes.
 */

const usd = (amount: bigint) => formatUsd(micros(amount));
const MAX_SUBAGENT_SECONDS = 30 * 24 * 60 * 60;

const approvalBody = z.object({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  amount_usd: z.string().regex(/^\d+(\.\d{1,6})?$/),
  purpose: z.string().min(1).max(500),
});

const taskCardBody = z.object({
  amount_usd: z.string().regex(/^\d+(\.\d{1,2})?$/),
  /** Stripe merchant category, e.g. computer_software_stores. */
  category: z.string().regex(/^[a-z_]{2,80}$/),
  purpose: z.string().min(1).max(500),
  merchant: z.string().max(200).optional(),
});

const subagentBody = z.object({
  name: z.string().min(1).max(100),
  purpose: z.string().min(1).max(500),
  budget_usd: z.string().regex(/^\d+(\.\d{1,6})?$/),
  period: z.enum(PERIODS).default('none'),
  models: z.array(z.string().min(1).max(200)).min(1).max(50).optional(),
  providers: z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
  max_per_action_usd: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .optional(),
  max_uses: z.number().int().min(1).optional(),
  expires_in_seconds: z
    .number()
    .int()
    .min(60)
    .max(MAX_SUBAGENT_SECONDS)
    .default(24 * 60 * 60),
});

function mandateView(mandate: typeof schema.mandates.$inferSelect, remaining: bigint | null) {
  return {
    id: mandate.id,
    parent_id: mandate.parentId,
    purpose: mandate.purpose,
    scope: mandate.scope,
    uses: mandate.uses,
    max_uses: mandate.maxUses,
    not_before: mandate.notBefore.toISOString(),
    expires_at: mandate.expiresAt.toISOString(),
    remaining_usd: remaining === null ? null : usd(remaining),
    jws: mandate.jws,
  };
}

function approvalView(
  approval: typeof schema.approvals.$inferSelect,
  card?: { id: string; last4: string | null; status: string; expiresAt: Date | null },
) {
  return {
    id: approval.id,
    status: approval.status,
    rail: approval.rail,
    resource: approval.resource,
    amount_usd: usd(approval.amount),
    approved_usd: approval.approvedAmount === null ? null : usd(approval.approvedAmount),
    purpose: approval.purpose,
    note: approval.decisionNote,
    expires_at: approval.expiresAt.toISOString(),
    decided_at: approval.decidedAt?.toISOString() ?? null,
    /** Card approvals: the single-use card issued once approved (never its number). */
    card:
      card === undefined
        ? null
        : { id: card.id, last4: card.last4, status: card.status, expires_at: card.expiresAt?.toISOString() ?? null },
  };
}

async function parseJson<T>(schemaOf: z.ZodType<T>, body: unknown): Promise<T> {
  const parsed = await schemaOf.safeParseAsync(body);
  if (!parsed.success) {
    throw new GatewayError(
      'aperture_invalid_request',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}

export function registerAgentRoutes(app: Hono, deps: GatewayDeps): void {
  /** Authenticates, runs the handler, and turns GatewayErrors into OpenAI-shaped errors. */
  const route =
    (
      handler: (caller: Caller, body: unknown, request: Request, params: Record<string, string>) => Promise<Response>,
      body = false,
    ) =>
    async (c: { req: { raw: Request; param: () => Record<string, string> } }) => {
      const requestId = uuidv7();
      const admitted = await admit(deps, c.req.raw, 'openai', requestId, { body });
      if (admitted instanceof Response) return admitted;
      try {
        return await handler(admitted.caller, admitted.body, c.req.raw, c.req.param());
      } catch (error) {
        if (error instanceof MandateError) {
          return errorResponse(
            new GatewayError('aperture_policy_denied', error.message, {
              code: error.code,
              violations: error.violations,
            }),
            'openai',
            requestId,
          );
        }
        if (error instanceof GatewayError) return errorResponse(error, 'openai', requestId);
        deps.logger.error({ err: error, requestId }, 'agent route failed');
        return errorResponse(
          new GatewayError('aperture_unavailable', 'Aperture is temporarily unavailable'),
          'openai',
          requestId,
        );
      } finally {
        admitted.releaseSlot();
      }
    };

  // Who am I, what may I spend, and under which mandate.
  app.get(
    '/v1/me',
    route(async (caller) => {
      const view = await withOrg(deps.db, caller.orgId, async (tx) => {
        const [principal] = await tx
          .select()
          .from(schema.principals)
          .where(eq(schema.principals.id, caller.principalId));
        const headroom = await budgetHeadroom(tx, {
          orgId: caller.orgId,
          principalId: caller.principalId,
          rail: 'gateway',
        });
        const mandate = await standingMandate(tx, caller.principalId);
        const mandateLeft =
          mandate?.budgetId == null ? null : await budgetNodeRemaining(tx, caller.orgId, mandate.budgetId);
        return { principal, headroom, mandate, mandateLeft };
      });
      const remaining = [view.headroom.remaining, view.mandateLeft].filter((value): value is bigint => value !== null);
      return Response.json({
        org_id: caller.orgId,
        principal: {
          id: caller.principalId,
          name: view.principal?.name ?? null,
          kind: view.principal?.kind ?? null,
          status: view.principal?.status ?? null,
          parent_principal_id: view.principal?.parentPrincipalId ?? null,
        },
        budget: {
          name: view.headroom.budgetName,
          remaining_usd:
            remaining.length === 0 ? null : usd(remaining.reduce((min, value) => (value < min ? value : min))),
        },
        mandate: view.mandate === undefined ? null : mandateView(view.mandate, view.mandateLeft),
      });
    }),
  );

  // The models this caller may use right now (connected, priced, and allowed by policy + mandate).
  app.get(
    '/v1/models',
    route(async (caller) => {
      const connected = [...(await connectedProviders(deps.db, deps.cache, caller.orgId))];
      const context = await loadPrincipalContext(deps.db, deps.cache, caller);
      const { rows, mandateLayers } = await withOrg(deps.db, caller.orgId, async (tx) => {
        const priced =
          connected.length === 0
            ? []
            : await tx.select().from(schema.prices).where(inArray(schema.prices.provider, connected));
        const mandate = await standingMandate(tx, caller.principalId);
        return {
          rows: priced,
          mandateLayers:
            mandate === undefined
              ? []
              : [
                  {
                    level: 'mandate' as const,
                    scopeId: mandate.id,
                    version: 1,
                    document: mandateToDocument(mandate.scope),
                  },
                ],
        };
      });
      const at = new Date();
      const data = rows
        .map((row) => ({
          row,
          decision: evaluatePolicy({
            action: { rail: 'gateway', amount: micros(0n), provider: row.provider, model: row.model },
            at,
            timeZone: context.timezone,
            layers: [...context.layers, ...mandateLayers],
          }),
        }))
        .filter(({ decision }) => decision.outcome !== 'deny')
        .map(({ row, decision }) => ({
          id: row.model,
          object: 'model',
          owned_by: row.provider,
          provider: row.provider,
          input_usd_per_mtok: usd(row.inputPerMTok),
          output_usd_per_mtok: usd(row.outputPerMTok),
          needs_approval: decision.outcome === 'require_approval',
        }));
      return Response.json({ object: 'list', data });
    }),
  );

  // Ask for approval ahead of time (the gateway also opens one when policy requires it).
  app.post(
    '/v1/approvals',
    route(async (caller, raw) => {
      const body = await parseJson(approvalBody, raw);
      const approval = await withOrg(deps.db, caller.orgId, (tx) =>
        requestApproval(tx, {
          orgId: caller.orgId,
          principalId: caller.principalId,
          rail: 'gateway',
          resource: `${body.provider}:${body.model}`,
          amount: parseUsd(body.amount_usd),
          purpose: body.purpose,
          context: { requestedBy: 'agent' },
        }),
      );
      await deps.onApprovalRequested?.(approval);
      return Response.json(approvalView(approval), { status: 201 });
    }, true),
  );

  app.get(
    '/v1/approvals/:id',
    route(async (caller, _body, _request, params) => {
      const id = params.id ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new GatewayError('aperture_invalid_request', 'not an approval id');
      const [row] = await withOrg(deps.db, caller.orgId, (tx) =>
        tx
          .select({ approval: schema.approvals, card: schema.cards })
          .from(schema.approvals)
          .leftJoin(schema.cards, eq(schema.cards.approvalId, schema.approvals.id))
          .where(and(eq(schema.approvals.id, id), eq(schema.approvals.requesterPrincipalId, caller.principalId))),
      );
      if (row === undefined) throw new GatewayError('aperture_invalid_request', 'no such approval for this caller');
      return Response.json(approvalView(row.approval, row.card ?? undefined));
    }),
  );

  // A single-use card for one purchase (plan/phases/phase-08 §8.5). Always via a person: the
  // approval opens now, and approving issues the card, capped at the approved amount.
  app.post(
    '/v1/cards/task',
    route(async (caller, raw) => {
      const body = await parseJson(taskCardBody, raw);
      const approval = await withOrg(deps.db, caller.orgId, (tx) =>
        requestApproval(tx, {
          orgId: caller.orgId,
          principalId: caller.principalId,
          rail: 'card',
          resource: `card:${body.category}`,
          amount: parseUsd(body.amount_usd),
          purpose: body.purpose,
          context: { requestedBy: 'agent', merchant: body.merchant ?? null, kind: 'task_card' },
        }),
      );
      await deps.onApprovalRequested?.(approval);
      return Response.json(approvalView(approval), { status: 202 });
    }, true),
  );

  // Delegation: a sub-agent with its own key and a mandate inside the caller's (P2).
  app.post(
    '/v1/subagents',
    route(async (caller, raw) => {
      const body = await parseJson(subagentBody, raw);
      const created = await withOrg(deps.db, caller.orgId, async (tx) => {
        const parent = await standingMandate(tx, caller.principalId);
        if (parent === undefined) {
          throw new GatewayError(
            'aperture_policy_denied',
            'only a caller holding a mandate can create sub-agents; ask an admin to issue one',
          );
        }
        const [me] = await tx.select().from(schema.principals).where(eq(schema.principals.id, caller.principalId));
        const [key] =
          caller.apiKeyId === null
            ? []
            : await tx
                .select({ createdBy: schema.apiKeys.createdBy })
                .from(schema.apiKeys)
                .where(eq(schema.apiKeys.id, caller.apiKeyId));
        const owner = me?.ownerUserId ?? me?.userId ?? key?.createdBy;
        if (owner == null)
          throw new GatewayError('aperture_policy_denied', 'this caller has no owner to answer for a sub-agent');

        const parentScope = parseScope(parent.scope);
        // Starts with the parent (the app clock may run ahead of the database's, P5); ends at the
        // requested lifetime or the parent's end, whichever is first.
        const notBefore = parent.notBefore;
        const expiresAt = new Date(Math.min(Date.now() + body.expires_in_seconds * 1000, parent.expiresAt.getTime()));
        const [principal] = await tx
          .insert(schema.principals)
          .values({
            id: uuidv7(),
            orgId: caller.orgId,
            kind: 'agent',
            name: body.name,
            parentPrincipalId: caller.principalId,
            ownerUserId: owner,
          })
          .returning();
        if (principal === undefined) throw new Error('insert returned no row');
        const mandate = await issueMandate(tx, deps.ring, {
          orgId: caller.orgId,
          subjectPrincipalId: principal.id,
          parentId: parent.id,
          issuerPrincipalId: caller.principalId,
          scope: {
            rails: parentScope.rails,
            ...(body.providers === undefined ? {} : { providers: body.providers }),
            ...(body.models === undefined ? {} : { models: body.models }),
            ...(body.max_per_action_usd === undefined ? {} : { maxPerAction: body.max_per_action_usd }),
            budget: { limit: body.budget_usd, period: body.period },
            notBefore: notBefore.toISOString(),
            expiresAt: expiresAt.toISOString(),
            ...(body.max_uses === undefined ? {} : { maxUses: body.max_uses }),
            purpose: body.purpose,
          },
        });
        const { key: secret, prefix } = generateApiKey(process.env.NODE_ENV === 'production' ? 'live' : 'test');
        const [apiKey] = await tx
          .insert(schema.apiKeys)
          .values({
            id: uuidv7(),
            orgId: caller.orgId,
            principalId: principal.id,
            name: `${body.name} (delegated)`,
            prefix: prefix.slice(0, API_KEY_PREFIX_LENGTH),
            hash: hashApiKey(secret, deps.pepper),
            createdBy: owner,
            expiresAt,
          })
          .returning();
        if (apiKey === undefined) throw new Error('insert returned no row');
        await appendAuditEvent(tx, caller.orgId, {
          actor: `agent:${caller.principalId}`,
          action: 'subagent.created',
          subject: `principal:${principal.id}`,
          data: { mandateId: mandate.id, parentMandateId: parent.id, budget: body.budget_usd, period: body.period },
        });
        return { principal, mandate, secret };
      });
      return Response.json(
        {
          principal_id: created.principal.id,
          name: created.principal.name,
          api_key: created.secret,
          mandate: mandateView(created.mandate, created.mandate.budgetId === null ? null : parseUsd(body.budget_usd)),
        },
        { status: 201 },
      );
    }, true),
  );

  // The agent's own kill switch: pausing is one-way from here; a human resumes it.
  app.post(
    '/v1/me/pause',
    route(async (caller) => {
      await withOrg(deps.db, caller.orgId, async (tx) => {
        await tx
          .update(schema.principals)
          .set({ status: 'paused' })
          .where(eq(schema.principals.id, caller.principalId));
        await appendAuditEvent(tx, caller.orgId, {
          actor: `agent:${caller.principalId}`,
          action: 'principal.paused_self',
          subject: `principal:${caller.principalId}`,
          data: {},
        });
      });
      return Response.json({ status: 'paused' });
    }),
  );
}

function mandateToDocument(scope: unknown) {
  return mandateToPolicyDocument(parseScope(scope));
}
