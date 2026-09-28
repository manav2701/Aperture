import { z } from 'zod';
import { ASSETS, CAIP2, assetByMint, type AssetInfo, type SolanaNetwork } from './networks';

/*
 * x402 v2 payment requirements (the `PAYMENT-REQUIRED` header of a 402 response) and the
 * payment payload we return for `PAYMENT-SIGNATURE` (plan/phases/phase-09 §9.3). Only the
 * `exact` scheme on Solana is supported; everything else is refused before any money moves.
 * Spec pinned: x402 v2, scheme_exact_svm (VERIFY against the spec on each x402 release).
 */

export const X402_VERSION = 2;
/** Longer than this and a signed transaction would sit around too long (X4). */
export const MAX_TIMEOUT_SECONDS = 300;

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'a base58 Solana address');

const requirementSchema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    amount: z.string().regex(/^\d{1,20}$/),
    asset: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number().int().positive().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type PaymentRequirement = z.infer<typeof requirementSchema>;

const paymentRequiredSchema = z
  .object({
    x402Version: z.number().int(),
    error: z.string().optional(),
    resource: z.object({ url: z.string().optional(), description: z.string().optional() }).loose().optional(),
    accepts: z.array(requirementSchema).min(1).max(20),
  })
  .loose();
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

export class X402Error extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'X402Error';
    this.code = code;
  }
}

/** Accepts the header value (base64 JSON), a JSON string, or the decoded object. */
export function decodePaymentRequired(input: unknown): PaymentRequired {
  let value = input;
  if (typeof input === 'string') {
    const text = input.trim();
    try {
      value = JSON.parse(text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8'));
    } catch {
      throw new X402Error('invalid_payment_required', 'PAYMENT-REQUIRED is not base64 JSON');
    }
  }
  const parsed = paymentRequiredSchema.safeParse(value);
  if (!parsed.success) throw new X402Error('invalid_payment_required', 'PAYMENT-REQUIRED does not match x402 v2');
  if (parsed.data.x402Version !== X402_VERSION) {
    throw new X402Error('unsupported_version', `only x402 version ${String(X402_VERSION)} is supported`);
  }
  return parsed.data;
}

export interface AcceptContext {
  network: SolanaNetwork;
  /** Assets the org's connection allows (subset of ASSETS for the network). */
  assets: readonly AssetInfo[];
  /** Hard cap for one payment, in atomic units. */
  maxAtomic: bigint;
}

export interface AcceptedRequirement {
  index: number;
  requirement: PaymentRequirement;
  asset: AssetInfo;
  amount: bigint;
  payTo: string;
  feePayer: string;
  timeoutSeconds: number;
}

/**
 * Picks the requirement we can pay (or the one the caller selected) and checks it: scheme,
 * network (X3), asset in the configured mints (X2), amount within the cap, sane timeout, fee
 * payer present and distinct from the payee. Throws X402Error with the first reason.
 */
export function acceptRequirement(
  required: PaymentRequired,
  context: AcceptContext,
  selectedIndex?: number,
): AcceptedRequirement {
  const candidates =
    selectedIndex === undefined
      ? required.accepts.map((requirement, index) => ({ requirement, index }))
      : required.accepts[selectedIndex] === undefined
        ? []
        : [{ requirement: required.accepts[selectedIndex], index: selectedIndex }];
  if (candidates.length === 0)
    throw new X402Error('no_matching_requirement', 'the selected requirement does not exist');

  let lastError = new X402Error('no_matching_requirement', 'no payment option is Solana exact in a configured asset');
  for (const { requirement, index } of candidates) {
    try {
      if (requirement.scheme !== 'exact')
        throw new X402Error('unsupported_scheme', `scheme ${requirement.scheme} is not supported`);
      if (requirement.network !== CAIP2[context.network]) {
        throw new X402Error(
          'wrong_network',
          `the seller wants ${requirement.network}; this org pays on ${CAIP2[context.network]}`,
        );
      }
      const asset = assetByMint(context.network, requirement.asset);
      if (asset === undefined || !context.assets.some((allowed) => allowed.mint === asset.mint)) {
        throw new X402Error('asset_not_allowed', 'the requested token is not a configured stablecoin');
      }
      if (!base58.safeParse(requirement.payTo).success)
        throw new X402Error('invalid_pay_to', 'payTo is not a Solana address');
      const feePayer = requirement.extra?.feePayer;
      if (typeof feePayer !== 'string' || !base58.safeParse(feePayer).success) {
        throw new X402Error('missing_fee_payer', 'the requirement names no facilitator fee payer');
      }
      if (feePayer === requirement.payTo)
        throw new X402Error('invalid_fee_payer', 'the fee payer may not be the payee');
      const amount = BigInt(requirement.amount);
      if (amount <= 0n) throw new X402Error('invalid_amount', 'the amount must be positive');
      if (amount > context.maxAtomic)
        throw new X402Error('amount_over_cap', 'the amount is over this agent’s per-payment cap');
      const timeoutSeconds = requirement.maxTimeoutSeconds ?? 60;
      if (timeoutSeconds > MAX_TIMEOUT_SECONDS)
        throw new X402Error('timeout_too_long', 'the payment window is too long');
      return { index, requirement, asset, amount, payTo: requirement.payTo, feePayer, timeoutSeconds };
    } catch (error) {
      if (!(error instanceof X402Error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** The `PAYMENT-SIGNATURE` header value: base64 JSON of the x402 v2 PaymentPayload. */
export function encodePaymentSignature(input: {
  resourceUrl: string;
  accepted: PaymentRequirement;
  transaction: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: X402_VERSION,
      resource: { url: input.resourceUrl },
      accepted: input.accepted,
      payload: { transaction: input.transaction },
    }),
  ).toString('base64');
}

export function decodePaymentSignature(header: string): { accepted: PaymentRequirement; transaction: string } {
  const parsed = z
    .object({
      x402Version: z.literal(X402_VERSION),
      accepted: requirementSchema,
      payload: z.object({ transaction: z.string() }),
    })
    .loose()
    .safeParse(JSON.parse(Buffer.from(header, 'base64').toString('utf8')));
  if (!parsed.success) throw new X402Error('invalid_payment_signature', 'PAYMENT-SIGNATURE is not an x402 v2 payload');
  return { accepted: parsed.data.accepted, transaction: parsed.data.payload.transaction };
}

export const assetsFor = (network: SolanaNetwork, names: readonly string[]) =>
  ASSETS[network].filter((asset) => names.includes(asset.asset));
