import type { RpcFetch } from './rpc';

/*
 * The depeg guard's input (X13): USDC/USD and USDT/USD from Pyth's public Hermes API (free, no
 * key). Budgets treat one stablecoin unit as one dollar, which is only safe near the peg.
 */

export const PYTH_FEEDS = {
  USDC: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  USDT: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
} as const;

/** ±2 % of the dollar. */
export const DEPEG_TOLERANCE = 0.02;
/** A price older than this is no price at all. */
const PRICE_MAX_AGE_SECONDS = 60 * 60;

export interface StablePrice {
  asset: 'USDC' | 'USDT';
  /** µUSD per token. */
  micros: bigint;
  publishedAt: Date;
}

export async function fetchStablecoinPrices(fetchImpl: RpcFetch): Promise<StablePrice[]> {
  const query = Object.values(PYTH_FEEDS)
    .map((id) => `ids[]=${id}`)
    .join('&');
  const response = await fetchImpl(`https://hermes.pyth.network/v2/updates/price/latest?${query}&parsed=true`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Pyth answered ${String(response.status)}`);
  const body = (await response.json()) as {
    parsed?: { id: string; price: { price: string; expo: number; publish_time: number } }[];
  };
  const prices: StablePrice[] = [];
  for (const entry of body.parsed ?? []) {
    const asset = (Object.keys(PYTH_FEEDS) as (keyof typeof PYTH_FEEDS)[]).find(
      (name) => PYTH_FEEDS[name].replace(/^0x/, '') === entry.id.replace(/^0x/, ''),
    );
    if (asset === undefined) continue;
    const shift = entry.price.expo + 6;
    const raw = BigInt(entry.price.price);
    const micros = shift >= 0 ? raw * 10n ** BigInt(shift) : raw / 10n ** BigInt(-shift);
    prices.push({ asset, micros, publishedAt: new Date(entry.price.publish_time * 1000) });
  }
  return prices;
}

/** undefined = fine; otherwise why paying in this asset is refused. */
export function depegReason(
  price: { micros: bigint; publishedAt: Date } | undefined,
  now = new Date(),
): string | undefined {
  if (price === undefined) return 'no recent price for the stablecoin';
  if (now.getTime() - price.publishedAt.getTime() > PRICE_MAX_AGE_SECONDS * 1000)
    return 'the stablecoin price is stale';
  const deviation = Math.abs(Number(price.micros) / 1_000_000 - 1);
  return deviation > DEPEG_TOLERANCE
    ? `the stablecoin is off its peg (${(Number(price.micros) / 1_000_000).toFixed(4)} USD)`
    : undefined;
}
