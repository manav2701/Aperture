import {
  LedgerError,
  adjust,
  and,
  asc,
  desc,
  eq,
  inArray,
  recordSpend,
  refund,
  schema,
  settle,
  withOrg,
  type Database,
  type Transaction,
} from '@aperture/db';
import { v7 as uuidv7 } from 'uuid';
import { USD_MICROS_PER_UNIT, toMicros } from './fx';
import {
  authorizationSchema,
  eventSchema,
  merchantOf,
  transactionSchema,
  type StripeAuthorization,
  type StripeTransaction,
} from './stripe';

/*
 * Stripe Issuing events → ledger (plan/phases/phase-08 §8.3). Events are at-least-once and
 * unordered (K3), so each is applied once (webhook_receipts) and the ledger only depends on the
 * set of events, not their order (INV-11):
 *
 * - captures are recorded as they arrive and settled against the authorization's holds when it
 *   closes; a capture after that is an unheld capture (K11);
 * - authorizations Stripe approved without asking us get no hold, so their captures are
 *   unheld captures (K2); captures without any authorization are force captures (K7);
 * - refunds reverse a capture of the same authorization when there is one, else adjust (K9, L13).
 */

export interface EventOutcome {
  status: 'applied' | 'duplicate' | 'ignored';
  /** Follow-up the caller performs after answering Stripe (it needs the network). */
  freezeCard?: string | undefined;
}

type CardRow = typeof schema.cards.$inferSelect;
type AuthRow = typeof schema.cardAuthorizations.$inferSelect;

async function raiseAlert(
  tx: Transaction,
  orgId: string,
  dedupeKey: string,
  kind: string,
  payload: Record<string, string | number>,
) {
  await tx.insert(schema.alertLog).values({ id: uuidv7(), orgId, dedupeKey, kind, payload }).onConflictDoNothing();
}

async function cardByExternalId(
  tx: Transaction,
  connectionId: string,
  externalId: string,
): Promise<CardRow | undefined> {
  const [card] = await tx
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.connectionId, connectionId), eq(schema.cards.externalId, externalId)));
  return card;
}

async function micros(tx: Transaction, amountMinor: number, currency: string): Promise<bigint> {
  const code = currency.toLowerCase();
  let rate = code === 'usd' ? USD_MICROS_PER_UNIT : undefined;
  if (rate === undefined) {
    const [row] = await tx
      .select({ rate: schema.fxRates.microsPerUnit })
      .from(schema.fxRates)
      .where(eq(schema.fxRates.currency, code))
      .orderBy(desc(schema.fxRates.day))
      .limit(1);
    rate = row?.rate;
  }
  // Throwing makes Stripe retry the event; the daily FX sync fills the gap.
  if (rate === undefined) throw new Error(`no exchange rate for ${currency}`);
  return toMicros(BigInt(Math.abs(amountMinor)), code, rate);
}

/** Settles an authorization's holds with everything captured under it (once, when it closes). */
async function settleAuthorization(tx: Transaction, auth: AuthRow): Promise<void> {
  const captures = await tx
    .select()
    .from(schema.cardTransactions)
    .where(
      and(
        eq(schema.cardTransactions.orgId, auth.orgId),
        eq(schema.cardTransactions.authorizationExternalId, auth.externalId),
        eq(schema.cardTransactions.type, 'capture'),
        eq(schema.cardTransactions.ledgerKind, 'pending'),
      ),
    );
  const total = captures.reduce((sum, capture) => sum + capture.amount, 0n);
  const holds =
    auth.holdIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.holds)
          .where(and(inArray(schema.holds.id, auth.holdIds), eq(schema.holds.status, 'open')))
          .orderBy(asc(schema.holds.createdAt));

  if (holds.length === 0) {
    // No open hold (Stripe approved without us, or the hold already expired): the money moved
    // anyway, so it counts as unheld spend.
    if (total > 0n) {
      await recordSpend(tx, {
        orgId: auth.orgId,
        principalId: auth.principalId,
        rail: 'card',
        kind: 'unheld_capture',
        amount: total,
        idempotencyKey: `card-settle:${auth.externalId}`,
        externalRef: auth.externalId,
        meta: {
          cardId: auth.cardId,
          reason: auth.decision === 'unseen' ? 'approved_without_aperture' : 'hold_expired',
        },
      });
    }
  } else {
    let remaining = total;
    for (const [index, hold] of holds.entries()) {
      const last = index === holds.length - 1;
      const share = last ? remaining : remaining < hold.amount ? remaining : hold.amount;
      remaining -= share;
      await settle(tx, {
        orgId: auth.orgId,
        holdId: hold.id,
        actualAmount: share,
        meta: { authorization: auth.externalId },
      });
    }
  }
  if (captures.length > 0) {
    await tx
      .update(schema.cardTransactions)
      .set({ ledgerKind: holds.length === 0 ? 'unheld_capture' : 'settled' })
      .where(
        inArray(
          schema.cardTransactions.id,
          captures.map((capture) => capture.id),
        ),
      );
  }
  await tx
    .update(schema.cardAuthorizations)
    .set({ settledAt: new Date(), settledAmount: total, updatedAt: new Date() })
    .where(eq(schema.cardAuthorizations.id, auth.id));
}

async function syncAuthorization(tx: Transaction, orgId: string, connectionId: string, stripe: StripeAuthorization) {
  const card = await cardByExternalId(tx, connectionId, stripe.card.id);
  if (card === undefined) {
    await raiseAlert(tx, orgId, `card-unknown:${stripe.card.id}`, 'card_unknown', { card: stripe.card.id });
    return;
  }
  let [auth] = await tx
    .select()
    .from(schema.cardAuthorizations)
    .where(and(eq(schema.cardAuthorizations.orgId, orgId), eq(schema.cardAuthorizations.externalId, stripe.id)));
  if (auth === undefined) {
    // We never answered for this one: Stripe decided on timeout, error, or Autopilot (K2).
    if (stripe.approved) {
      const reason = stripe.request_history.at(-1)?.reason ?? 'unknown';
      await raiseAlert(tx, orgId, `card-unseen:${stripe.id}`, 'card_unseen_authorization', {
        card: card.id,
        authorization: stripe.id,
        reason,
        merchant: stripe.merchant_data.name ?? '',
      });
    }
    [auth] = await tx
      .insert(schema.cardAuthorizations)
      .values({
        id: uuidv7(),
        orgId,
        cardId: card.id,
        principalId: card.principalId,
        externalId: stripe.id,
        decision: stripe.approved ? 'unseen' : 'declined',
        requested: stripe.approved ? await micros(tx, stripe.amount, stripe.currency) : 0n,
        currency: stripe.currency.toLowerCase(),
        merchant: merchantOf(stripe.merchant_data),
      })
      .returning();
    if (auth === undefined) throw new Error('insert returned no row');
  }
  if (auth.status !== stripe.status) {
    await tx
      .update(schema.cardAuthorizations)
      .set({ status: stripe.status, updatedAt: new Date() })
      .where(eq(schema.cardAuthorizations.id, auth.id));
  }
  // Reversed, expired or closed: whatever was captured is final for this authorization (K5).
  if (stripe.status !== 'pending' && auth.settledAt === null) await settleAuthorization(tx, auth);
}

async function recordTransaction(
  tx: Transaction,
  orgId: string,
  connectionId: string,
  stripe: StripeTransaction,
): Promise<string | undefined> {
  const card = await cardByExternalId(tx, connectionId, stripe.card);
  if (card === undefined) {
    await raiseAlert(tx, orgId, `card-unknown:${stripe.card}`, 'card_unknown', { card: stripe.card });
    return undefined;
  }
  const amount = await micros(tx, stripe.amount, stripe.currency);
  const [inserted] = await tx
    .insert(schema.cardTransactions)
    .values({
      id: uuidv7(),
      orgId,
      cardId: card.id,
      principalId: card.principalId,
      externalId: stripe.id,
      authorizationExternalId: stripe.authorization ?? null,
      type: stripe.type,
      amount: stripe.type === 'capture' ? amount : -amount,
      currency: stripe.currency.toLowerCase(),
      merchant: merchantOf(stripe.merchant_data),
      ledgerKind: 'pending',
    })
    .onConflictDoNothing()
    .returning();
  if (inserted === undefined) return undefined;
  const setKind = (ledgerKind: string) =>
    tx.update(schema.cardTransactions).set({ ledgerKind }).where(eq(schema.cardTransactions.id, inserted.id));

  if (stripe.type === 'refund') {
    await applyRefund(tx, orgId, card, stripe, amount);
    await setKind('refund');
    return undefined;
  }

  const authId = stripe.authorization ?? null;
  if (authId !== null) {
    const [auth] = await tx
      .select()
      .from(schema.cardAuthorizations)
      .where(and(eq(schema.cardAuthorizations.orgId, orgId), eq(schema.cardAuthorizations.externalId, authId)));
    // Not settled yet (or not seen yet): it joins the authorization's settlement.
    if (auth?.settledAt == null) return undefined;
    // Captured after the authorization was settled: extra money moved without a hold (K11).
    await recordSpend(tx, {
      orgId,
      principalId: card.principalId,
      rail: 'card',
      kind: 'unheld_capture',
      amount,
      idempotencyKey: `card-capture:${stripe.id}`,
      externalRef: authId,
      meta: { cardId: card.id, transaction: stripe.id, reason: 'late_capture' },
    });
    await setKind('late_capture');
    return undefined;
  }

  // A force capture: no authorization at all (K7). Counted, alerted, and task cards frozen (K8).
  await recordSpend(tx, {
    orgId,
    principalId: card.principalId,
    rail: 'card',
    kind: 'unheld_capture',
    amount,
    idempotencyKey: `card-capture:${stripe.id}`,
    externalRef: stripe.id,
    meta: { cardId: card.id, transaction: stripe.id, reason: 'force_capture' },
  });
  await setKind('force_capture');
  await raiseAlert(tx, orgId, `card-force-capture:${stripe.id}`, 'card_unheld_capture', {
    card: card.id,
    transaction: stripe.id,
    merchant: stripe.merchant_data.name ?? '',
  });
  if (card.kind === 'task' && card.status === 'active') {
    await tx.update(schema.cards).set({ status: 'inactive' }).where(eq(schema.cards.id, card.id));
    return card.externalId;
  }
  return undefined;
}

async function applyRefund(tx: Transaction, orgId: string, card: CardRow, stripe: StripeTransaction, amount: bigint) {
  const originals =
    stripe.authorization == null
      ? []
      : await tx
          .select()
          .from(schema.ledgerEntries)
          .where(
            and(
              eq(schema.ledgerEntries.orgId, orgId),
              eq(schema.ledgerEntries.externalRef, stripe.authorization),
              inArray(schema.ledgerEntries.kind, ['capture', 'unheld_capture']),
            ),
          )
          .orderBy(asc(schema.ledgerEntries.occurredAt));
  for (const original of originals) {
    try {
      await tx.transaction((inner) =>
        refund(inner, {
          orgId,
          originalEntryId: original.id,
          amount,
          idempotencyKey: `card-refund:${stripe.id}`,
          meta: { transaction: stripe.id },
        }),
      );
      return;
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
    }
  }
  // Unlinked refund, or more than any one capture: an adjustment keeps the totals right.
  await adjust(tx, {
    orgId,
    principalId: card.principalId,
    rail: 'card',
    amount: -amount,
    idempotencyKey: `card-refund:${stripe.id}`,
    meta: { transaction: stripe.id, reason: 'card_refund', cardId: card.id },
  });
}

export async function applyStripeEvent(
  db: Database,
  input: { orgId: string; connectionId: string; event: unknown },
): Promise<EventOutcome> {
  const parsed = eventSchema.safeParse(input.event);
  if (!parsed.success) return { status: 'ignored' };
  const event = parsed.data;
  return withOrg(db, input.orgId, async (tx) => {
    const [fresh] = await tx
      .insert(schema.webhookReceipts)
      .values({ orgId: input.orgId, source: `stripe:${input.connectionId}`, eventId: event.id })
      .onConflictDoNothing()
      .returning();
    if (fresh === undefined) return { status: 'duplicate' };

    switch (event.type) {
      case 'issuing_authorization.created':
      case 'issuing_authorization.updated': {
        const auth = authorizationSchema.safeParse(event.data.object);
        if (!auth.success) return { status: 'ignored' };
        await syncAuthorization(tx, input.orgId, input.connectionId, auth.data);
        return { status: 'applied' };
      }
      case 'issuing_transaction.created': {
        const transaction = transactionSchema.safeParse(event.data.object);
        if (!transaction.success) return { status: 'ignored' };
        const freezeCard = await recordTransaction(tx, input.orgId, input.connectionId, transaction.data);
        return { status: 'applied', freezeCard };
      }
      case 'issuing_card.updated': {
        const card = event.data.object as { id?: unknown; status?: unknown };
        if (
          typeof card.id === 'string' &&
          (card.status === 'active' || card.status === 'inactive' || card.status === 'canceled')
        ) {
          await tx
            .update(schema.cards)
            .set({ status: card.status, ...(card.status === 'canceled' ? { canceledAt: new Date() } : {}) })
            .where(and(eq(schema.cards.connectionId, input.connectionId), eq(schema.cards.externalId, card.id)));
        }
        return { status: 'applied' };
      }
      default:
        return { status: 'ignored' };
    }
  });
}
