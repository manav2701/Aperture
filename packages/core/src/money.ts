/**
 * Money is an integer number of micro-US-dollars (µUSD): 1 µUSD = 0.000001 USD, which is
 * exactly one atomic unit of USDC/USDT (6 decimals). Never use JS numbers or floats for money.
 */
declare const microsBrand: unique symbol;
export type Micros = bigint & { readonly [microsBrand]: true };

export const MICROS_PER_USD = 1_000_000n;
/** Largest magnitude we accept: Postgres `bigint` range, so every amount fits the ledger columns. */
export const MAX_ABS_MICROS = 9_223_372_036_854_775_807n;

export class MoneyError extends Error {
  readonly code: 'invalid_format' | 'negative' | 'out_of_range' | 'invalid_decimals';

  constructor(code: MoneyError['code'], message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/** Brands a bigint as `Micros` after checking it fits the ledger's range. */
export function micros(value: bigint): Micros {
  if (value > MAX_ABS_MICROS || value < -MAX_ABS_MICROS) {
    throw new MoneyError('out_of_range', `amount ${value.toString()} µUSD exceeds the supported range`);
  }
  return value as Micros;
}

export function nonNegativeMicros(value: bigint): Micros {
  if (value < 0n) throw new MoneyError('negative', `amount must not be negative, got ${value.toString()} µUSD`);
  return micros(value);
}

const USD_PATTERN = /^(-)?(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;

/**
 * Parses a decimal USD string such as "12.5" or "0.000001". Rejects more than 6 decimals,
 * exponents, whitespace, leading zeros, and a bare leading dot, so every value has one spelling.
 */
export function parseUsd(input: string, options: { allowNegative?: boolean } = {}): Micros {
  const match = USD_PATTERN.exec(input);
  if (!match) {
    throw new MoneyError('invalid_format', `"${input}" is not a USD amount with at most 6 decimals`);
  }
  const [, sign, whole = '0', fraction = ''] = match;
  const magnitude = BigInt(whole) * MICROS_PER_USD + BigInt(fraction.padEnd(6, '0'));
  const value = sign ? -magnitude : magnitude;
  if (value < 0n && !options.allowNegative) {
    throw new MoneyError('negative', `"${input}" is negative`);
  }
  return micros(value);
}

/** Exact decimal string, trailing zeros trimmed down to `minDecimals`. `parseUsd` inverts it. */
export function formatUsd(amount: Micros, options: { minDecimals?: number } = {}): string {
  const minDecimals = options.minDecimals ?? 2;
  const value: bigint = amount;
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / MICROS_PER_USD;
  let fraction = (magnitude % MICROS_PER_USD).toString().padStart(6, '0');
  while (fraction.length > minDecimals && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  const body = fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Display rounding to `decimals` places, half away from zero. Not for arithmetic. */
export function formatUsdRounded(amount: Micros, decimals = 2): string {
  if (decimals < 0 || decimals > 6) throw new MoneyError('invalid_decimals', 'decimals must be between 0 and 6');
  const step = 10n ** BigInt(6 - decimals);
  const value: bigint = amount;
  const magnitude = value < 0n ? -value : value;
  const rounded = ((magnitude + step / 2n) / step) * step;
  const text = formatUsd(micros(rounded), { minDecimals: decimals });
  const [whole = '0', fraction = ''] = text.split('.');
  const fixed = decimals === 0 ? whole : `${whole}.${fraction.slice(0, decimals)}`;
  return amount < 0n && rounded !== 0n ? `-${fixed}` : fixed;
}

export function fromCents(cents: bigint): Micros {
  return micros(cents * 10_000n);
}

/**
 * Converts atomic token units to µUSD for a USD-pegged token. Tokens with more than 6
 * decimals are rounded up so conversions never under-count spend.
 */
export function fromAtomicUsd(amount: bigint, decimals: number): Micros {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new MoneyError('invalid_decimals', `unsupported token decimals: ${String(decimals)}`);
  }
  if (decimals <= 6) return micros(amount * 10n ** BigInt(6 - decimals));
  return micros(ceilDiv(amount, 10n ** BigInt(decimals - 6)));
}

/** Ceiling division for non-negative numerators and positive denominators. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator < 0n) throw new RangeError('numerator must not be negative');
  return (numerator + denominator - 1n) / denominator;
}
