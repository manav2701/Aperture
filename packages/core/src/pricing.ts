import { ceilDiv, micros, type Micros } from './money';

/**
 * Prices are stored in µUSD per unit. Token prices are per *million* tokens so that fractions
 * of a micro-dollar per token stay exact (USD 2.50 / 1M tokens = 2_500_000 µUSD per 1M).
 * Every estimate rounds up and charges at least 1 µUSD, so a cheap model can't be used for free.
 */
export interface TextPrice {
  inputPerMTok: bigint;
  outputPerMTok: bigint;
  cacheReadPerMTok?: bigint;
  cacheWritePerMTok?: bigint;
  /** Upper bound for one image in a prompt. */
  perInputImage?: bigint;
}

export interface MediaPrice {
  perImage?: bigint;
  perSecond?: bigint;
}

const MILLION = 1_000_000n;
const MIN_CHARGE = 1n;

/** Deliberately over-counts: most tokenizers average 3–4 bytes per token for English; Arabic and code tokenize worse. */
export const BYTES_PER_TOKEN_ESTIMATE = 3n;

const perMillion = (tokens: bigint, pricePerMTok: bigint) => ceilDiv(tokens * pricePerMTok, MILLION);

export interface TextEstimateInput {
  promptBytes: bigint;
  inputImages: bigint;
  maxOutputTokens: bigint;
}

export function estimateTextCost(input: TextEstimateInput, price: TextPrice): Micros {
  const inputTokens = ceilDiv(input.promptBytes, BYTES_PER_TOKEN_ESTIMATE);
  const images = input.inputImages * (price.perInputImage ?? 0n);
  const total =
    perMillion(inputTokens, price.inputPerMTok) + perMillion(input.maxOutputTokens, price.outputPerMTok) + images;
  return micros(total > MIN_CHARGE ? total : MIN_CHARGE);
}

export interface TextUsage {
  /** Uncached input tokens. */
  inputTokens: bigint;
  /** Includes reasoning tokens. */
  outputTokens: bigint;
  cacheReadTokens?: bigint;
  cacheWriteTokens?: bigint;
}

export function actualTextCost(usage: TextUsage, price: TextPrice): Micros {
  const total =
    perMillion(usage.inputTokens, price.inputPerMTok) +
    perMillion(usage.outputTokens, price.outputPerMTok) +
    perMillion(usage.cacheReadTokens ?? 0n, price.cacheReadPerMTok ?? price.inputPerMTok) +
    perMillion(usage.cacheWriteTokens ?? 0n, price.cacheWritePerMTok ?? price.inputPerMTok);
  return micros(total > MIN_CHARGE ? total : MIN_CHARGE);
}

export type MediaRequest = { kind: 'image'; count: bigint } | { kind: 'video'; seconds: bigint; count: bigint };

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

export function estimateMediaCost(request: MediaRequest, price: MediaPrice): Micros {
  let total: bigint;
  if (request.kind === 'image') {
    if (price.perImage === undefined) throw new PricingError('no per-image price for this model');
    total = request.count * price.perImage;
  } else {
    if (price.perSecond === undefined) throw new PricingError('no per-second price for this model');
    total = request.seconds * request.count * price.perSecond;
  }
  return micros(total > MIN_CHARGE ? total : MIN_CHARGE);
}
