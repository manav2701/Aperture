/*
 * Stripe Issuing payloads for tests, shaped like the documented objects (only fields Aperture
 * reads, plus a few it ignores). There is no Stripe sandbox access yet (D5), so these fixtures
 * are the contract until live tests run.
 */

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${String(Date.now())}${String((sequence += 1))}x`;

export interface AuthorizationFixture {
  id?: string;
  card: string;
  /** Minor units of `currency` (cents for USD). */
  amount: number;
  currency?: string;
  status?: 'pending' | 'closed' | 'reversed' | 'expired';
  approved?: boolean;
  /** The amount being decided now; defaults to `amount` (null once decided). */
  pending?: number | null;
  history?: { approved: boolean; reason?: string }[];
  category?: string;
  mcc?: string;
  country?: string;
  merchant?: string;
}

export function authorizationObject(input: AuthorizationFixture) {
  return {
    id: input.id ?? nextId('iauth'),
    object: 'issuing.authorization',
    approved: input.approved ?? true,
    status: input.status ?? 'pending',
    amount: input.amount,
    currency: input.currency ?? 'usd',
    livemode: false,
    card: { id: input.card, object: 'issuing.card' },
    merchant_data: {
      category: input.category ?? 'computer_software_stores',
      category_code: input.mcc ?? '5734',
      country: input.country ?? 'US',
      name: input.merchant ?? 'Acme Software',
      network_id: '1234567890',
    },
    pending_request:
      input.pending === null
        ? null
        : { amount: input.pending ?? input.amount, currency: input.currency ?? 'usd', is_amount_controllable: false },
    request_history: input.history ?? [],
  };
}

export function transactionObject(input: {
  id?: string;
  card: string;
  authorization?: string | null;
  type?: 'capture' | 'refund';
  /** Positive minor units; captures are sent negative, as Stripe does. */
  amount: number;
  currency?: string;
}) {
  const type = input.type ?? 'capture';
  return {
    id: input.id ?? nextId('ipi'),
    object: 'issuing.transaction',
    type,
    amount: type === 'capture' ? -input.amount : input.amount,
    currency: input.currency ?? 'usd',
    authorization: input.authorization ?? null,
    card: input.card,
    merchant_data: {
      category: 'computer_software_stores',
      category_code: '5734',
      country: 'US',
      name: 'Acme Software',
    },
  };
}

export function stripeEvent(type: string, object: Record<string, unknown>, id = nextId('evt')) {
  return { id, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } };
}
