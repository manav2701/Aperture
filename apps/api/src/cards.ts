import {
  CardSetupError,
  applyStripeEvent,
  authorizationSchema,
  authorizeCard,
  issueCard,
  openStripeSecrets,
  setCardStatus,
  STRIPE_API_VERSION,
  stripeConnectionById,
  verifyStripeSignature,
} from '@aperture/cards';
import { and, eq, schema, withOrg, type ApprovalRow } from '@aperture/db';
import { metrics } from '@aperture/runtime';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps, AppEnv } from './http/context';

/*
 * Stripe Issuing webhooks (plan/phases/phase-08 §8.2–8.3). The authorization endpoint is the
 * hot path: signature check, one database transaction, answer. Anything that needs the network
 * (freezing a card after a force capture) happens after the answer. On any doubt we decline.
 */

const TASK_CARD_TTL_MS = 24 * 60 * 60 * 1000;
const SECRET_TTL_MS = 60_000;

interface CachedConnection {
  orgId: string;
  authorizationSecret: string;
  eventsSecret: string;
  expires: number;
}

/** Connection secrets, cached briefly so the hot path decrypts once a minute, not per request. */
function secretCache(deps: AppDeps) {
  const entries = new Map<string, CachedConnection>();
  return async (connectionId: string): Promise<CachedConnection | undefined> => {
    const hit = entries.get(connectionId);
    if ((hit?.expires ?? 0) > Date.now()) return hit;
    if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return undefined;
    const connection = await stripeConnectionById(deps.db, connectionId);
    if (connection?.status !== 'active') return undefined;
    const secrets = openStripeSecrets(deps.ring, connection);
    const entry = {
      orgId: connection.orgId,
      authorizationSecret: secrets.authorizationSecret,
      eventsSecret: secrets.eventsSecret,
      expires: Date.now() + SECRET_TTL_MS,
    };
    entries.set(connectionId, entry);
    if (entries.size > 10_000) entries.clear();
    return entry;
  };
}

export function registerStripeWebhooks(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const connectionFor = secretCache(deps);
  const answer = (approved: boolean, metadata: Record<string, string>) =>
    new Response(JSON.stringify({ approved, metadata }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'stripe-version': STRIPE_API_VERSION },
    });

  app.post('/webhooks/stripe/:connectionId/authorization', async (c) => {
    const started = Date.now();
    const raw = await c.req.text();
    const connection = await connectionFor(c.req.param('connectionId')).catch(() => undefined);
    if (connection === undefined) return c.text('unknown connection', 404);
    if (!verifyStripeSignature(connection.authorizationSecret, c.req.header('stripe-signature') ?? null, raw)) {
      return c.text('invalid signature', 400);
    }
    try {
      const event = JSON.parse(raw) as { type?: string; data?: { object?: unknown } };
      if (event.type !== 'issuing_authorization.request') return answer(false, { aperture_reason: 'unexpected_event' });
      const authorization = authorizationSchema.safeParse(event.data?.object);
      if (!authorization.success) return answer(false, { aperture_reason: 'invalid_payload' });
      const decision = await authorizeCard(deps.db, {
        orgId: connection.orgId,
        connectionId: c.req.param('connectionId'),
        authorization: authorization.data,
      });
      metrics.inc('aperture_card_decisions_total', { approved: String(decision.approved), code: decision.code });
      metrics.observe('aperture_card_decision_ms', {}, Date.now() - started);
      deps.logger.info(
        {
          authorization: authorization.data.id,
          approved: decision.approved,
          code: decision.code,
          ms: Date.now() - started,
        },
        'card authorization decided',
      );
      return answer(decision.approved, {
        aperture_reason: decision.code,
        ...(decision.holdId === null ? {} : { aperture_hold_id: decision.holdId }),
        ...(decision.approvalId === null ? {} : { aperture_approval_id: decision.approvalId }),
      });
    } catch (error) {
      deps.logger.error({ err: error }, 'card authorization failed; declining');
      return answer(false, { aperture_reason: 'error' });
    }
  });

  app.post('/webhooks/stripe/:connectionId/events', async (c) => {
    const raw = await c.req.text();
    const connectionId = c.req.param('connectionId');
    const connection = await connectionFor(connectionId).catch(() => undefined);
    if (connection === undefined) return c.text('unknown connection', 404);
    if (!verifyStripeSignature(connection.eventsSecret, c.req.header('stripe-signature') ?? null, raw)) {
      return c.text('invalid signature', 400);
    }
    let outcome;
    try {
      outcome = await applyStripeEvent(deps.db, { orgId: connection.orgId, connectionId, event: JSON.parse(raw) });
    } catch (error) {
      // A 5xx makes Stripe retry later (e.g. once today's FX rates are in).
      deps.logger.error({ err: error }, 'Stripe event failed');
      return c.text('retry later', 500);
    }
    const freeze = outcome.freezeCard;
    if (freeze !== undefined) {
      void freezeByExternalId(deps, connection.orgId, connectionId, freeze);
    }
    return c.json({ received: true, status: outcome.status });
  });
}

async function freezeByExternalId(deps: AppDeps, orgId: string, connectionId: string, externalId: string) {
  try {
    const [card] = await withOrg(deps.db, orgId, (tx) =>
      tx
        .select({ id: schema.cards.id })
        .from(schema.cards)
        .where(and(eq(schema.cards.connectionId, connectionId), eq(schema.cards.externalId, externalId))),
    );
    if (card === undefined) return;
    await setCardStatus(deps.db, deps.ring, {
      orgId,
      cardId: card.id,
      status: 'inactive',
      actor: 'system:cards',
      fetch: deps.jobs.fetch,
    });
  } catch (error) {
    deps.logger.warn({ err: error, card: externalId }, 'could not freeze card at Stripe');
  }
}

/**
 * After a card-rail approval: a single-use card for exactly what was approved (§8.5), under
 * the one-shot mandate the approval issued. Returns undefined when Stripe isn't connected.
 */
export async function taskCardForApproval(deps: AppDeps, approval: ApprovalRow, userId: string) {
  if (approval.rail !== 'card' || approval.status !== 'approved' || approval.approvedAmount === null) return undefined;
  const category = approval.resource.startsWith('card:') ? approval.resource.slice(5) : '';
  try {
    return await issueCard(deps.db, deps.ring, {
      orgId: approval.orgId,
      principalId: approval.requesterPrincipalId,
      kind: 'task',
      backstop: {
        perAuthorization: approval.approvedAmount,
        ...(category === '' || category === 'unknown' ? {} : { categories: [category] }),
      },
      purpose: approval.purpose,
      approvalId: approval.id,
      ...(approval.mandateId === null ? {} : { mandateId: approval.mandateId }),
      expiresAt: new Date(Date.now() + TASK_CARD_TTL_MS),
      createdBy: userId,
      fetch: deps.jobs.fetch,
    });
  } catch (error) {
    if (error instanceof CardSetupError) return undefined;
    throw error;
  }
}
