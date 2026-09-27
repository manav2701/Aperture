import {
  evaluatePolicy,
  formatUsd,
  mandateToPolicyDocument,
  micros,
  type Decision,
  type PolicyLayer,
} from '@aperture/core';
import {
  MandateError,
  and,
  appendAuditEvent,
  consumeMandateUse,
  desc,
  eq,
  hasStandingMandate,
  mandateChain,
  parseScope,
  principalPolicyContext,
  requestApproval,
  reserve,
  schema,
  standingMandate,
  withOrg,
  type Database,
  type MandateRow,
  type Transaction,
} from '@aperture/db';
import { v7 as uuidv7 } from 'uuid';
import { USD_MICROS_PER_UNIT, toMicros } from './fx';
import { merchantOf, type StripeAuthorization } from './stripe';

/*
 * The real-time authorization decision (plan/phases/phase-08 §8.2). Stripe waits about two
 * seconds and, with the timeout behaviour set to decline (K1), declines if we don't answer.
 * Everything here is one database transaction and nothing else: no outbound calls.
 */

/** Longest a card authorization stays open at Stripe (hotels, car rental); the hold backstop. */
const HOLD_TTL_SECONDS = 31 * 24 * 60 * 60;

export interface CardDecision {
  approved: boolean;
  /** Machine-readable first reason when declined. */
  code: string;
  reasons: { code: string; message: string }[];
  amountMicros: bigint | null;
  holdId: string | null;
  approvalId: string | null;
}

const decline = (code: string, message: string, extra: Partial<CardDecision> = {}): CardDecision => ({
  approved: false,
  code,
  reasons: [{ code, message }],
  amountMicros: null,
  holdId: null,
  approvalId: null,
  ...extra,
});

/** µUSD per one major unit of `currency`, from the newest stored rate (never fetched here). */
async function rateFor(tx: Transaction, currency: string): Promise<bigint | undefined> {
  if (currency.toLowerCase() === 'usd') return USD_MICROS_PER_UNIT;
  const [row] = await tx
    .select({ rate: schema.fxRates.microsPerUnit })
    .from(schema.fxRates)
    .where(eq(schema.fxRates.currency, currency.toLowerCase()))
    .orderBy(desc(schema.fxRates.day))
    .limit(1);
  return row?.rate;
}

async function queueCardAlert(
  tx: Transaction,
  orgId: string,
  dedupeKey: string,
  kind: string,
  payload: Record<string, string | number>,
) {
  await tx.insert(schema.alertLog).values({ id: uuidv7(), orgId, dedupeKey, kind, payload }).onConflictDoNothing();
}

export async function authorizeCard(
  db: Database,
  input: { orgId: string; connectionId: string; authorization: StripeAuthorization },
): Promise<CardDecision> {
  const auth = input.authorization;
  const request = auth.pending_request;
  if (request == null) return decline('no_pending_request', 'nothing to decide');
  const merchant = merchantOf(auth.merchant_data);

  return withOrg(db, input.orgId, async (tx) => {
    const [card] = await tx
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.connectionId, input.connectionId), eq(schema.cards.externalId, auth.card.id)));

    // Unknown card: Aperture didn't issue it, so nobody decided it may spend (fail closed).
    if (card === undefined) {
      await queueCardAlert(tx, input.orgId, `card-unknown:${auth.card.id}`, 'card_unknown', {
        card: auth.card.id,
        merchant: merchant.name ?? '',
      });
      await appendAuditEvent(tx, input.orgId, {
        actor: 'system:card-authorization',
        action: 'card.authorization.declined',
        subject: `stripe_card:${auth.card.id}`,
        data: { authorization: auth.id, reasons: ['unknown_card'], merchant: merchant.name },
      });
      return decline('unknown_card', 'this card was not issued through Aperture');
    }

    const record = async (decision: CardDecision) => {
      const [existing] = await tx
        .select()
        .from(schema.cardAuthorizations)
        .where(
          and(eq(schema.cardAuthorizations.orgId, input.orgId), eq(schema.cardAuthorizations.externalId, auth.id)),
        );
      if (existing === undefined) {
        await tx.insert(schema.cardAuthorizations).values({
          id: uuidv7(),
          orgId: input.orgId,
          cardId: card.id,
          principalId: card.principalId,
          externalId: auth.id,
          decision: decision.approved ? 'approved' : 'declined',
          reasons: decision.reasons,
          holdIds: decision.holdId === null ? [] : [decision.holdId],
          requested: decision.approved ? (decision.amountMicros ?? 0n) : 0n,
          currency: request.currency.toLowerCase(),
          merchant,
        });
      } else if (decision.approved && decision.holdId !== null && !existing.holdIds.includes(decision.holdId)) {
        // An incremental authorization: its own hold on the same authorization (K4).
        await tx
          .update(schema.cardAuthorizations)
          .set({
            holdIds: [...existing.holdIds, decision.holdId],
            requested: existing.requested + (decision.amountMicros ?? 0n),
            decision: 'approved',
            updatedAt: new Date(),
          })
          .where(eq(schema.cardAuthorizations.id, existing.id));
      }
      await appendAuditEvent(tx, input.orgId, {
        actor: 'system:card-authorization',
        action: decision.approved ? 'card.authorization.approved' : 'card.authorization.declined',
        subject: `card:${card.id}`,
        data: {
          authorization: auth.id,
          amount: decision.amountMicros === null ? null : formatUsd(micros(decision.amountMicros)),
          currency: request.currency,
          merchant: merchant.name,
          category: merchant.category,
          country: merchant.country,
          reasons: decision.reasons.map((reason) => reason.code),
        },
      });
      return decision;
    };

    if (card.status !== 'active') return record(decline('card_inactive', `the card is ${card.status}`));
    if (card.expiresAt !== null && card.expiresAt.getTime() <= Date.now()) {
      return record(decline('card_expired', 'this task card has expired'));
    }

    const rate = await rateFor(tx, request.currency);
    if (rate === undefined) {
      return record(decline('fx_unavailable', `no exchange rate for ${request.currency.toUpperCase()}`));
    }
    const amount = toMicros(BigInt(request.amount), request.currency, rate);

    // Authority: a task card acts under the one-shot mandate its approval issued; an agent card
    // under the agent's standing mandate (if it has ever had one, it must still be usable).
    let mandate: MandateRow | undefined;
    if (card.mandateId !== null) {
      mandate = (await mandateChain(tx, card.mandateId))[0];
    } else {
      mandate = await standingMandate(tx, card.principalId);
      if (mandate === undefined && (await hasStandingMandate(tx, card.principalId))) {
        return record(decline('mandate_unusable', 'the agent’s mandate was revoked, has expired, or is used up'));
      }
    }
    const chain = mandate === undefined ? [] : await mandateChain(tx, mandate.id);
    const mandateLayers: PolicyLayer[] = chain.map((link) => ({
      level: 'mandate',
      scopeId: link.id,
      version: 1,
      document: mandateToPolicyDocument(parseScope(link.scope)),
    }));

    const context = await principalPolicyContext(tx, input.orgId, card.principalId);
    const decision: Decision = evaluatePolicy({
      action: {
        rail: 'card',
        amount: micros(amount),
        merchant: {
          ...(merchant.category === null ? {} : { category: merchant.category }),
          ...(merchant.country === null ? {} : { country: merchant.country }),
          ...(merchant.name === null ? {} : { name: merchant.name }),
        },
      },
      at: new Date(),
      timeZone: context.timezone,
      layers: [...context.layers, ...mandateLayers],
    });
    const reasons = decision.reasons.map((reason) => ({ code: reason.code, message: reason.message }));
    if (decision.outcome === 'deny') {
      return record({
        ...decline(reasons[0]?.code ?? 'policy_denied', reasons[0]?.message ?? 'denied by policy'),
        reasons,
        amountMicros: amount,
      });
    }

    if (decision.outcome === 'require_approval') {
      const [approved] =
        card.approvalId === null
          ? []
          : await tx.select().from(schema.approvals).where(eq(schema.approvals.id, card.approvalId));
      const covered = approved?.approvedAmount != null && amount <= approved.approvedAmount;
      if (!covered) {
        // Declined now; a person can approve, which issues a single-use task card (K16, §8.5).
        const approval = await requestApproval(tx, {
          orgId: input.orgId,
          principalId: card.principalId,
          rail: 'card',
          resource: `card:${merchant.category ?? 'unknown'}`,
          amount,
          purpose: `Card purchase at ${merchant.name ?? 'unknown merchant'}`,
          context: {
            cardId: card.id,
            authorization: auth.id,
            merchant,
            currency: request.currency,
            amountMinor: request.amount,
            reasons: decision.reasons.map((reason) => ({
              code: reason.code,
              message: reason.message,
              ruleId: reason.ruleId ?? null,
              level: reason.level ?? null,
              scopeId: reason.scopeId ?? null,
            })),
          },
        });
        return record({
          ...decline('approval_required', 'a person must approve this purchase', { approvalId: approval.id }),
          reasons,
          amountMicros: amount,
        });
      }
    }

    const reserved = await reserve(tx, {
      orgId: input.orgId,
      principalId: card.principalId,
      rail: 'card',
      amount,
      idempotencyKey: `card:${auth.id}:${String(auth.request_history.length)}`,
      ttlSeconds: HOLD_TTL_SECONDS,
      onExpiry: 'release',
      ...(mandate?.budgetId == null ? {} : { mandateBudgetId: mandate.budgetId }),
      resource: `card:${merchant.category ?? 'unknown'}`,
      externalRef: auth.id,
      meta: { cardId: card.id, merchant: merchant.name, currency: request.currency, amountMinor: request.amount },
    });
    if (!reserved.ok) {
      const message =
        reserved.reason === 'budget_exceeded'
          ? `budget "${reserved.budgetName}" has $${formatUsd(micros(reserved.remaining))} left`
          : reserved.reason === 'principal_inactive'
            ? 'the agent is paused or revoked'
            : 'no budget covers this agent';
      return record({ ...decline(reserved.reason, message), amountMicros: amount });
    }
    if (!reserved.replayed) {
      try {
        if (mandate !== undefined) await consumeMandateUse(tx, mandate.id);
      } catch (error) {
        if (error instanceof MandateError) {
          // The mandate ran out between the check and now: undo the hold with the whole decision.
          throw new MandateDeclined(error.message);
        }
        throw error;
      }
      if (card.approvalId !== null) {
        await tx
          .update(schema.approvals)
          .set({ status: 'used' })
          .where(and(eq(schema.approvals.id, card.approvalId), eq(schema.approvals.status, 'approved')));
      }
    }
    return record({
      approved: true,
      code: 'approved',
      reasons: [],
      amountMicros: amount,
      holdId: reserved.hold.id,
      approvalId: card.approvalId,
    });
  }).catch(async (error: unknown) => {
    if (!(error instanceof MandateDeclined)) throw error;
    // The rolled-back transaction took the hold with it; record the decline on its own.
    return declineOutsideHold(db, input, error.message);
  });
}

class MandateDeclined extends Error {}

async function declineOutsideHold(
  db: Database,
  input: { orgId: string; connectionId: string; authorization: StripeAuthorization },
  message: string,
): Promise<CardDecision> {
  const decision = decline('mandate_exhausted', message);
  await withOrg(db, input.orgId, (tx) =>
    appendAuditEvent(tx, input.orgId, {
      actor: 'system:card-authorization',
      action: 'card.authorization.declined',
      subject: `authorization:${input.authorization.id}`,
      data: { reasons: ['mandate_exhausted'] },
    }),
  );
  return decision;
}
