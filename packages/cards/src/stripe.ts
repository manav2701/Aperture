import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FetchLike } from '@aperture/connectors';
import { z } from 'zod';

/*
 * The slice of Stripe Issuing that Aperture uses, against the customer's own restricted key
 * (plan/phases/phase-08 §8.1). Card numbers and CVCs are never requested (K13): the client
 * refuses any request that expands them, and a Semgrep rule bans writing one.
 */

const STRIPE_API = 'https://api.stripe.com';
/** Pinned so Stripe's payload shapes don't change under us. */
export const STRIPE_API_VERSION = '2024-06-20';
const SIGNATURE_TOLERANCE_SECONDS = 300;

export class StripeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
    this.code = code;
  }
}

/** Stripe-Signature: `t=<unix>,v1=<hex hmac of "t.body">[,v1=…]` (several during secret rolls). */
export function verifyStripeSignature(
  secret: string,
  header: string | null,
  rawBody: string,
  now = Date.now(),
): boolean {
  if (header === null) return false;
  const parts = header.split(',').map((part) => part.split('=', 2) as [string, string | undefined]);
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  if (timestamp === undefined || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return parts.some(([key, value]) => {
    if (key !== 'v1' || value === undefined || !/^[0-9a-f]{64}$/.test(value)) return false;
    return timingSafeEqual(Buffer.from(value, 'hex'), expected);
  });
}

/** Test helper and fake-Stripe signer; production only verifies. */
export function signStripePayload(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${String(timestamp)},v1=${createHmac('sha256', secret)
    .update(`${String(timestamp)}.${rawBody}`)
    .digest('hex')}`;
}

// ---------------------------------------------------------------------------------------------
// Payloads (only the fields we read; everything else passes through)

const merchantSchema = z
  .object({
    category: z.string().max(100).nullish(),
    category_code: z.string().max(10).nullish(),
    country: z.string().max(10).nullish(),
    name: z.string().max(200).nullish(),
    network_id: z.string().max(100).nullish(),
  })
  .loose();

export const authorizationSchema = z
  .object({
    id: z.string().regex(/^iauth_[A-Za-z0-9]+$/),
    object: z.literal('issuing.authorization'),
    approved: z.boolean(),
    status: z.enum(['pending', 'closed', 'reversed', 'expired']),
    amount: z.number().int(),
    currency: z.string().length(3),
    card: z.object({ id: z.string().regex(/^ic_[A-Za-z0-9]+$/) }).loose(),
    merchant_data: merchantSchema,
    pending_request: z
      .object({
        amount: z.number().int().min(0),
        currency: z.string().length(3),
        is_amount_controllable: z.boolean().optional(),
      })
      .loose()
      .nullish(),
    request_history: z.array(z.object({ approved: z.boolean(), reason: z.string().optional() }).loose()).default([]),
  })
  .loose();
export type StripeAuthorization = z.infer<typeof authorizationSchema>;

export const transactionSchema = z
  .object({
    id: z.string().regex(/^ipi_[A-Za-z0-9]+$/),
    object: z.literal('issuing.transaction'),
    type: z.enum(['capture', 'refund']),
    /** Negative for captures (money out), positive for refunds, in the card currency's minor unit. */
    amount: z.number().int(),
    currency: z.string().length(3),
    authorization: z.string().nullish(),
    card: z.string(),
    merchant_data: merchantSchema,
  })
  .loose();
export type StripeTransaction = z.infer<typeof transactionSchema>;

export const eventSchema = z
  .object({
    id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
    type: z.string(),
    created: z.number().int(),
    data: z.object({ object: z.record(z.string(), z.unknown()) }),
  })
  .loose();

export const merchantOf = (data: z.infer<typeof merchantSchema>) => ({
  category: data.category ?? null,
  mcc: data.category_code ?? null,
  country: data.country ?? null,
  name: data.name ?? null,
  networkId: data.network_id ?? null,
});

// ---------------------------------------------------------------------------------------------
// API client (form-encoded, like Stripe's own SDKs)

type Param = string | number | boolean | null | undefined | Param[] | { [key: string]: Param };

/** `{ a: { b: [ { c: 1 } ] } }` → `a[b][0][c]=1`. */
export function formEncode(params: Record<string, Param>): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, value: Param) => {
    if (value === undefined) return;
    if (value === null) out.append(prefix, '');
    else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(`${prefix}[${String(index)}]`, item);
      });
    } else if (typeof value === 'object')
      for (const [key, inner] of Object.entries(value)) walk(`${prefix}[${key}]`, inner);
    else out.append(prefix, String(value));
  };
  for (const [key, value] of Object.entries(params)) walk(key, value);
  return out.toString();
}

export interface StripeClient {
  request<T = Record<string, unknown>>(
    method: 'GET' | 'POST',
    path: string,
    params?: Record<string, Param>,
  ): Promise<T>;
}

export function stripeClient(apiKey: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)): StripeClient {
  return {
    async request<T>(method: 'GET' | 'POST', path: string, params: Record<string, Param> = {}): Promise<T> {
      if (/expand.*number|number.*expand/i.test(`${path}?${formEncode(params)}`)) {
        throw new Error('Aperture never requests card numbers (K13)');
      }
      const query = formEncode(params);
      const url = method === 'GET' && query !== '' ? `${STRIPE_API}${path}?${query}` : `${STRIPE_API}${path}`;
      const response = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'stripe-version': STRIPE_API_VERSION,
          ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(method === 'POST' ? { body: query } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; type?: string; message?: string };
      };
      if (!response.ok) {
        throw new StripeError(
          response.status,
          body.error?.code ?? body.error?.type ?? 'stripe_error',
          body.error?.message ?? `Stripe answered ${String(response.status)}`,
        );
      }
      return body as T;
    },
  };
}
