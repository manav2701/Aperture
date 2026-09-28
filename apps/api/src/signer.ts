import { keyRingFromEnv } from '@aperture/crypto';
import type { Database } from '@aperture/db';
import { SignerUnavailable, httpSigner, type SignerClient } from '@aperture/gateway';
import type { Logger } from '@aperture/runtime';
import { SignerRefusal, createDelegateKey, signPayment } from '@aperture/signer';
import { solanaRpc, type SolanaNetwork } from '@aperture/x402';

/*
 * How this process reaches the x402 signer (plan/phases/phase-09 §9.2):
 * - SIGNER_URL + SIGNER_SHARED_SECRET: the separate signer service on the private network
 *   (production);
 * - EMBED_SIGNER=true + SIGNER_KEK_V1: in this process (single-host staging only — the signer's
 *   key then lives next to the API's);
 * - neither: crypto payments are off.
 */
export function signerFromEnv(
  env: {
    SIGNER_URL?: string | undefined;
    SIGNER_SHARED_SECRET?: string | undefined;
    EMBED_SIGNER: boolean;
    SIGNER_KEK_V1?: string | undefined;
    SIGNER_RPC_DEVNET?: string | undefined;
    SIGNER_RPC_MAINNET?: string | undefined;
  },
  db: Database,
  logger: Logger,
): SignerClient | undefined {
  if (env.SIGNER_URL !== undefined && env.SIGNER_SHARED_SECRET !== undefined) {
    return httpSigner(env.SIGNER_URL, env.SIGNER_SHARED_SECRET);
  }
  if (!env.EMBED_SIGNER) {
    logger.info('SIGNER_URL not set and EMBED_SIGNER off: x402 payments are disabled');
    return undefined;
  }
  if (env.SIGNER_KEK_V1 === undefined) {
    logger.warn('EMBED_SIGNER=true needs SIGNER_KEK_V1: x402 payments are disabled');
    return undefined;
  }
  logger.warn('the x402 signer runs inside the API process: fine for staging, not for production');
  const urls: Record<SolanaNetwork, string[]> = {
    devnet: (env.SIGNER_RPC_DEVNET ?? 'https://api.devnet.solana.com').split(','),
    mainnet: (env.SIGNER_RPC_MAINNET ?? 'https://api.mainnet-beta.solana.com').split(','),
  };
  const deps = {
    db,
    ring: keyRingFromEnv({ APERTURE_KEK_V1: env.SIGNER_KEK_V1 }),
    rpcFor: (network: SolanaNetwork) => solanaRpc(urls[network]),
  };
  const refusalsAsUnavailable = async <T>(run: () => Promise<T>) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof SignerRefusal) throw new SignerUnavailable(error.code, error.message);
      throw error;
    }
  };
  return {
    sign: (orgId, paymentId) => refusalsAsUnavailable(() => signPayment(deps, { orgId, paymentId })),
    createKey: (orgId, accountId) => refusalsAsUnavailable(() => createDelegateKey(deps, { orgId, accountId })),
  };
}
