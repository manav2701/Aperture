import type { FetchLike } from '@aperture/connectors';
import { decryptSecret, encryptSecret, type KeyRing } from '@aperture/crypto';
import { and, appendAuditEvent, eq, schema, withOrg, withSystem, type Database, type DbOrTx } from '@aperture/db';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { stripeClient, type StripeClient } from './stripe';

/*
 * Cards on the customer's own Stripe Issuing program (plan/phases/phase-08 §8.1, §8.4). One
 * company cardholder per org; each card carries the agent in its metadata, and a coarse
 * spending_controls backstop in case a decision ever doesn't reach Stripe.
 */

export const STRIPE_PROVIDER = 'stripe_issuing';

export interface StripeSecrets {
  /** Restricted key: Issuing cards, cardholders, authorizations, transactions; Disputes. */
  apiKey: string;
  /** Signing secret of the real-time authorization endpoint (`whsec_…`). */
  authorizationSecret: string;
  /** Signing secret of the events endpoint (`whsec_…`). */
  eventsSecret: string;
}

const secretsSchema = z.object({ apiKey: z.string(), authorizationSecret: z.string(), eventsSecret: z.string() });
const context = (orgId: string, connectionId: string) => `${orgId}|${connectionId}`;

export function openStripeSecrets(
  ring: KeyRing,
  connection: { orgId: string; id: string; secret: unknown },
): StripeSecrets {
  return secretsSchema.parse(
    JSON.parse(decryptSecret(connection.secret, context(connection.orgId, connection.id), ring)),
  );
}

/**
 * The webhook routes know only the connection id in their URL; this finds its org (system
 * scope, one indexed read) so the rest runs under that org's row-level security.
 */
export async function stripeConnectionById(db: Database, connectionId: string) {
  const [row] = await withSystem(db, (tx) =>
    tx
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.id, connectionId), eq(schema.connections.provider, STRIPE_PROVIDER))),
  );
  return row;
}

export async function activeStripeConnection(tx: DbOrTx, orgId: string) {
  const [row] = await tx
    .select()
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.orgId, orgId),
        eq(schema.connections.provider, STRIPE_PROVIDER),
        eq(schema.connections.status, 'active'),
      ),
    );
  return row;
}

export interface CompanyDetails {
  name: string;
  line1: string;
  city: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2, e.g. US. */
  country: string;
  state?: string | undefined;
}

/**
 * Checks the restricted key, creates the company cardholder, and stores everything encrypted.
 * Disables any earlier Stripe connection of the org (one card program at a time).
 */
export async function connectStripe(
  db: Database,
  ring: KeyRing,
  input: {
    orgId: string;
    userId: string;
    secrets: StripeSecrets;
    company: CompanyDetails;
    fetch?: FetchLike | undefined;
  },
) {
  const stripe = stripeClient(input.secrets.apiKey, input.fetch);
  const probe = await stripe.request<{ livemode?: boolean }>('GET', '/v1/issuing/cardholders', { limit: 1 });
  const cardholder = await stripe.request<{ id: string }>('POST', '/v1/issuing/cardholders', {
    type: 'company',
    name: input.company.name,
    billing: {
      address: {
        line1: input.company.line1,
        city: input.company.city,
        postal_code: input.company.postalCode,
        country: input.company.country,
        ...(input.company.state === undefined ? {} : { state: input.company.state }),
      },
    },
    metadata: { aperture_org_id: input.orgId },
  });
  return withOrg(db, input.orgId, async (tx) => {
    await tx
      .update(schema.connections)
      .set({ status: 'disabled' })
      .where(and(eq(schema.connections.orgId, input.orgId), eq(schema.connections.provider, STRIPE_PROVIDER)));
    const id = uuidv7();
    const [row] = await tx
      .insert(schema.connections)
      .values({
        id,
        orgId: input.orgId,
        provider: STRIPE_PROVIDER,
        name: 'Stripe Issuing',
        fingerprint: `${cardholder.id}:${id}`,
        secret: encryptSecret(JSON.stringify(input.secrets), context(input.orgId, id), ring),
        config: { cardholderId: cardholder.id, livemode: probe.livemode === true },
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    await appendAuditEvent(tx, input.orgId, {
      actor: `user:${input.userId}`,
      action: 'cards.stripe_connected',
      subject: `connection:${id}`,
      data: { cardholderId: cardholder.id },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------------------------
// Backstop controls (mirrored to Stripe; Aperture's real-time decision is the real control)

export interface Backstop {
  /** µUSD. */
  perAuthorization?: bigint | undefined;
  /** µUSD; the budget plus 10 % slack so the backstop never blocks what Aperture allowed. */
  monthly?: bigint | undefined;
  /** Stripe merchant category names. */
  categories?: string[] | undefined;
  countries?: string[] | undefined;
}

const cents = (amount: bigint) => Number((amount + 9_999n) / 10_000n);

export function spendingControls(backstop: Backstop) {
  const limits: { amount: number; interval: string }[] = [];
  if (backstop.perAuthorization !== undefined)
    limits.push({ amount: cents(backstop.perAuthorization), interval: 'per_authorization' });
  if (backstop.monthly !== undefined)
    limits.push({ amount: cents((backstop.monthly * 110n) / 100n), interval: 'monthly' });
  return {
    ...(limits.length === 0 ? {} : { spending_limits: limits }),
    ...(backstop.categories === undefined || backstop.categories.length === 0
      ? {}
      : { allowed_categories: backstop.categories }),
    ...(backstop.countries === undefined || backstop.countries.length === 0
      ? {}
      : { allowed_merchant_countries: backstop.countries }),
  };
}

export interface NewCard {
  orgId: string;
  principalId: string;
  kind: 'agent' | 'task';
  backstop: Backstop;
  purpose?: string | undefined;
  approvalId?: string | undefined;
  mandateId?: string | undefined;
  /** Task cards: canceled by the cards.expire job if unused by then (K12). */
  expiresAt?: Date | undefined;
  createdBy?: string | undefined;
}

/** Creates a virtual card at Stripe (never asking for its number) and records it. */
export async function issueCard(
  db: Database,
  ring: KeyRing,
  input: NewCard & { fetch?: FetchLike | undefined; stripe?: StripeClient | undefined },
) {
  const connection = await withOrg(db, input.orgId, (tx) => activeStripeConnection(tx, input.orgId));
  if (connection === undefined) throw new CardSetupError('connect Stripe Issuing first');
  const secrets = openStripeSecrets(ring, connection);
  const stripe = input.stripe ?? stripeClient(secrets.apiKey, input.fetch);
  const cardholderId = (connection.config as { cardholderId?: string }).cardholderId;
  if (cardholderId === undefined) throw new CardSetupError('the Stripe connection has no cardholder');
  const controls = spendingControls(input.backstop);
  const created = await stripe.request<{ id: string; last4?: string; currency?: string }>('POST', '/v1/issuing/cards', {
    cardholder: cardholderId,
    currency: 'usd',
    type: 'virtual',
    status: 'active',
    metadata: { aperture_org_id: input.orgId, aperture_principal_id: input.principalId, aperture_kind: input.kind },
    spending_controls: controls,
    ...(input.kind === 'task' ? { lifecycle_controls: { cancel_after: { payment_count: 1 } } } : {}),
  });
  return withOrg(db, input.orgId, async (tx) => {
    const [card] = await tx
      .insert(schema.cards)
      .values({
        id: uuidv7(),
        orgId: input.orgId,
        connectionId: connection.id,
        principalId: input.principalId,
        externalId: created.id,
        kind: input.kind,
        last4: created.last4 ?? null,
        currency: created.currency ?? 'usd',
        controls,
        purpose: input.purpose ?? null,
        approvalId: input.approvalId ?? null,
        mandateId: input.mandateId ?? null,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!card) throw new Error('insert returned no row');
    await appendAuditEvent(tx, input.orgId, {
      actor: input.createdBy === undefined ? 'system:cards' : `user:${input.createdBy}`,
      action: 'card.issued',
      subject: `card:${card.id}`,
      data: { principalId: input.principalId, kind: input.kind, approvalId: input.approvalId ?? null },
    });
    return card;
  });
}

export class CardSetupError extends Error {}

/** Freeze (inactive), unfreeze (active) or cancel (permanent), at Stripe first, then here. */
export async function setCardStatus(
  db: Database,
  ring: KeyRing,
  input: {
    orgId: string;
    cardId: string;
    status: 'active' | 'inactive' | 'canceled';
    actor: string;
    fetch?: FetchLike | undefined;
  },
) {
  const found = await withOrg(db, input.orgId, async (tx) => {
    const [card] = await tx
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.id, input.cardId), eq(schema.cards.orgId, input.orgId)));
    if (!card) return undefined;
    const [connection] = await tx.select().from(schema.connections).where(eq(schema.connections.id, card.connectionId));
    return connection === undefined ? undefined : { card, connection };
  });
  if (found === undefined) throw new CardSetupError('card not found');
  if (found.card.status === 'canceled') throw new CardSetupError('the card is canceled');
  const stripe = stripeClient(openStripeSecrets(ring, found.connection).apiKey, input.fetch);
  await stripe.request('POST', `/v1/issuing/cards/${found.card.externalId}`, { status: input.status });
  return withOrg(db, input.orgId, async (tx) => {
    const [card] = await tx
      .update(schema.cards)
      .set({ status: input.status, ...(input.status === 'canceled' ? { canceledAt: new Date() } : {}) })
      .where(eq(schema.cards.id, input.cardId))
      .returning();
    await appendAuditEvent(tx, input.orgId, {
      actor: input.actor,
      action: `card.${input.status === 'active' ? 'unfrozen' : input.status === 'inactive' ? 'frozen' : 'canceled'}`,
      subject: `card:${input.cardId}`,
      data: {},
    });
    return card;
  });
}
