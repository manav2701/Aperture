import type { RpcFetch } from './rpc';

/*
 * The depeg guard's input (X13): USDC/USD and USDT/USD from CoinGecko's public price API (free,
 * no key; Pyth's Hermes API started requiring a key in 2026-10). Budgets treat one stablecoin unit
 * as one dollar, which is only safe near the peg.
 */

export const COINGECKO_IDS = { USDC: 'usd-coin', USDT: 'tether' } as const;

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
  const ids = Object.values(COINGECKO_IDS).join(',');
  const response = await fetchImpl(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_last_updated_at=true`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`CoinGecko answered ${String(response.status)}`);
  const body = (await response.json()) as Record<string, { usd?: number; last_updated_at?: number } | undefined>;
  const prices: StablePrice[] = [];
  for (const asset of Object.keys(COINGECKO_IDS) as (keyof typeof COINGECKO_IDS)[]) {
    const entry = body[COINGECKO_IDS[asset]];
    if (entry?.usd === undefined || entry.last_updated_at === undefined || !Number.isFinite(entry.usd)) continue;
    prices.push({
      asset,
      micros: BigInt(Math.round(entry.usd * 1_000_000)),
      publishedAt: new Date(entry.last_updated_at * 1000),
    });
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
