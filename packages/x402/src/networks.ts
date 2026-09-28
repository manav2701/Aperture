/*
 * Networks and assets Aperture pays with (plan/phases/phase-09 §9.1, X2, X3, X9). Mints are
 * hardcoded constants per network — never taken from a seller's payment requirement.
 */

export type SolanaNetwork = 'devnet' | 'mainnet';
export type StableAsset = 'USDC' | 'USDT';

/** CAIP-2 ids (genesis-hash prefixes) used in x402 `network` fields. */
export const CAIP2: Record<SolanaNetwork, string> = {
  mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};

export interface AssetInfo {
  asset: StableAsset;
  mint: string;
  decimals: number;
}

export const ASSETS: Record<SolanaNetwork, AssetInfo[]> = {
  mainnet: [
    { asset: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    { asset: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  ],
  // Circle's devnet USDC (faucet.circle.com). There is no official devnet USDT.
  devnet: [{ asset: 'USDC', mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 }],
};

export const networkOfCaip2 = (caip2: string): SolanaNetwork | undefined =>
  (Object.keys(CAIP2) as SolanaNetwork[]).find((network) => CAIP2[network] === caip2);

export const assetByMint = (network: SolanaNetwork, mint: string): AssetInfo | undefined =>
  ASSETS[network].find((asset) => asset.mint === mint);

/**
 * Atomic stablecoin units → µUSD. Both USDC and USDT have 6 decimals, so one atomic unit is one
 * µUSD at par; the depeg guard (X13) is what protects the assumption of par.
 */
export function atomicToMicros(amount: bigint, decimals: number): bigint {
  if (decimals === 6) return amount;
  if (decimals < 6) return amount * 10n ** BigInt(6 - decimals);
  const scale = 10n ** BigInt(decimals - 6);
  return (amount + scale - 1n) / scale;
}
