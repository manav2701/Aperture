import type { FetchLike } from '@aperture/connectors';

/*
 * Card amounts arrive in the card's currency, in its minor unit (K10). Budgets are µUSD. Rates
 * are fetched once a day (never on the authorization path) and holds round up, so a converted
 * hold is never smaller than the real amount.
 */

/** ISO 4217 minor-unit exponents that aren't 2 (Stripe's list of zero- and three-decimal currencies). */
const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

export function minorUnitExponent(currency: string): number {
  const code = currency.toLowerCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

export const USD_MICROS_PER_UNIT = 1_000_000n;

/** Minor units of `currency` → µUSD, rounded up. `microsPerUnit`: µUSD per one major unit. */
export function toMicros(amountMinor: bigint, currency: string, microsPerUnit: bigint): bigint {
  const scale = 10n ** BigInt(minorUnitExponent(currency));
  const product = amountMinor * microsPerUnit;
  const quotient = product / scale;
  return product % scale === 0n || product < 0n ? quotient : quotient + 1n;
}

/**
 * GCC currencies are pegged to the dollar and missing from the ECB set, so they are fixed here
 * (central bank pegs).
 */
export const PEGGED_TO_USD: Record<string, number> = {
  aed: 3.6725,
  sar: 3.75,
  qar: 3.64,
  omr: 0.3845,
  bhd: 0.376,
  jod: 0.709,
};

/**
 * Today's rates as µUSD per unit: Frankfurter (ECB reference rates, free, no key), plus the
 * pegs. USD itself is always exactly 1.
 */
export async function fetchFxRates(fetchImpl: FetchLike): Promise<Record<string, bigint>> {
  const response = await fetchImpl('https://api.frankfurter.dev/v1/latest?base=USD', {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`FX source answered ${String(response.status)}`);
  const body = (await response.json()) as { rates?: Record<string, number> };
  const perDollar: Record<string, number> = { ...PEGGED_TO_USD };
  for (const [code, rate] of Object.entries(body.rates ?? {})) {
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0) perDollar[code.toLowerCase()] = rate;
  }
  const rates: Record<string, bigint> = { usd: USD_MICROS_PER_UNIT };
  for (const [code, rate] of Object.entries(perDollar)) rates[code] = BigInt(Math.ceil(1_000_000 / rate));
  return rates;
}
