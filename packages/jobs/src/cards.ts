import { createHash } from 'node:crypto';
import {
  STRIPE_PROVIDER,
  applyStripeEvent,
  fetchFxRates,
  openStripeSecrets,
  setCardStatus,
  stripeClient,
} from '@aperture/cards';
import { and, eq, isNotNull, lt, schema, sql, withSystem } from '@aperture/db';
import { queueAlert } from './alerts';
import { dbOf, type JobDeps } from './deps';

/*
 * Card rail upkeep (plan/phases/phase-08 §8.3–8.6): today's FX rates for the hot path (K10),
 * canceling task cards nobody used (K12), and a nightly reconciliation that replays Stripe's own
 * view of recent authorizations and transactions through the same state machine, so missed or
 * failed webhooks can't leave the ledger wrong.
 */

const RECONCILE_DAYS = 7;
const MAX_PAGES = 20;

export async function syncFxRates(deps: JobDeps): Promise<number> {
  const rates = await fetchFxRates(deps.fetch ?? ((input, init) => fetch(input, init)));
  const day = new Date().toISOString().slice(0, 10);
  const rows = Object.entries(rates).map(([currency, microsPerUnit]) => ({
    currency,
    day,
    microsPerUnit,
    source: currency === 'usd' ? 'fixed' : 'frankfurter/ecb+pegs',
  }));
  await withSystem(dbOf(deps), (tx) =>
    tx
      .insert(schema.fxRates)
      .values(rows)
      .onConflictDoUpdate({
        target: [schema.fxRates.currency, schema.fxRates.day],
        set: { microsPerUnit: sql`excluded.micros_per_unit`, updatedAt: new Date() },
      }),
  );
  return rows.length;
}

/** Task cards live 24 hours; unused ones are canceled at Stripe (K12). */
export async function expireTaskCards(deps: JobDeps): Promise<number> {
  const stale = await withSystem(dbOf(deps), (tx) =>
    tx
      .select({ id: schema.cards.id, orgId: schema.cards.orgId })
      .from(schema.cards)
      .where(
        and(
          eq(schema.cards.kind, 'task'),
          eq(schema.cards.status, 'active'),
          isNotNull(schema.cards.expiresAt),
          lt(schema.cards.expiresAt, sql`now()`),
        ),
      )
      .limit(100),
  );
  let canceled = 0;
  for (const card of stale) {
    try {
      await setCardStatus(dbOf(deps), deps.ring, {
        orgId: card.orgId,
        cardId: card.id,
        status: 'canceled',
        actor: 'system:cards',
        fetch: deps.fetch,
      });
      canceled += 1;
    } catch (error) {
      deps.logger.warn({ err: error, card: card.id }, 'could not cancel expired task card');
    }
  }
  return canceled;
}

const syntheticId = (...parts: string[]) =>
  `evt_rec${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)}`;

interface Page<T> {
  data: T[];
  has_more: boolean;
}

export async function reconcileCards(deps: JobDeps): Promise<{ replayed: number; timeouts: number }> {
  const connections = await withSystem(dbOf(deps), (tx) =>
    tx
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.provider, STRIPE_PROVIDER), eq(schema.connections.status, 'active'))),
  );
  const since = Math.floor(Date.now() / 1000) - RECONCILE_DAYS * 86_400;
  let replayed = 0;
  let timeouts = 0;
  for (const connection of connections) {
    try {
      const stripe = stripeClient(openStripeSecrets(deps.ring, connection).apiKey, deps.fetch);
      const all = async <T extends { id: string }>(path: string) => {
        const items: T[] = [];
        let after: string | undefined;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const result = await stripe.request<Page<T>>('GET', path, {
            limit: 100,
            created: { gte: since },
            ...(after === undefined ? {} : { starting_after: after }),
          });
          items.push(...result.data);
          after = result.data.at(-1)?.id;
          if (!result.has_more || after === undefined) break;
        }
        return items;
      };
      const authorizations = await all<{
        id: string;
        status: string;
        amount: number;
        request_history?: { reason?: string }[];
      }>('/v1/issuing/authorizations');
      const transactions = await all<{ id: string }>('/v1/issuing/transactions');
      let connectionTimeouts = 0;
      for (const auth of authorizations) {
        if (
          auth.request_history?.some((entry) => entry.reason === 'webhook_timeout' || entry.reason === 'webhook_error')
        ) {
          connectionTimeouts += 1;
        }
        const outcome = await applyStripeEvent(dbOf(deps), {
          orgId: connection.orgId,
          connectionId: connection.id,
          event: {
            id: syntheticId(auth.id, auth.status, String(auth.amount)),
            type: 'issuing_authorization.updated',
            created: Math.floor(Date.now() / 1000),
            data: { object: auth },
          },
        });
        if (outcome.status === 'applied') replayed += 1;
      }
      for (const transaction of transactions) {
        const outcome = await applyStripeEvent(dbOf(deps), {
          orgId: connection.orgId,
          connectionId: connection.id,
          event: {
            id: syntheticId(transaction.id),
            type: 'issuing_transaction.created',
            created: Math.floor(Date.now() / 1000),
            data: { object: transaction },
          },
        });
        if (outcome.status === 'applied') replayed += 1;
      }
      if (connectionTimeouts > 0) {
        // Stripe decided without us: the endpoint was slow or down, or the timeout isn't "decline" (K1).
        await queueAlert(deps, connection.orgId, {
          dedupeKey: `card-timeouts:${connection.id}:${new Date().toISOString().slice(0, 10)}`,
          kind: 'card_decisions_timing_out',
          payload: { count: connectionTimeouts, days: RECONCILE_DAYS },
        });
      }
      timeouts += connectionTimeouts;
    } catch (error) {
      deps.logger.warn({ err: error, connection: connection.id }, 'card reconciliation failed');
    }
  }
  return { replayed, timeouts };
}
