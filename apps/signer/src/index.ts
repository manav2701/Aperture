import { keyRingFromEnv } from '@aperture/crypto';
import { connect } from '@aperture/db';
import { createLogger, loadEnvOrExit, runService, serviceEnvSchema } from '@aperture/runtime';
import { solanaRpc, type SolanaNetwork } from '@aperture/x402';
import { z } from 'zod';
import { buildApp } from './app';

const env = loadEnvOrExit(
  serviceEnvSchema(4300).extend({
    DATABASE_URL: z.url(),
    /** The signer's own key-encryption key (32 bytes, base64): never given to the API or gateway. */
    SIGNER_KEK_V1: z.string().min(40),
    /** Shared with the gateway and API (SIGNER_SHARED_SECRET there too). */
    SIGNER_SHARED_SECRET: z.string().min(32),
    /** Comma-separated RPC URLs per network (primary first). */
    SIGNER_RPC_DEVNET: z.string().default('https://api.devnet.solana.com'),
    SIGNER_RPC_MAINNET: z.string().default('https://api.mainnet-beta.solana.com'),
  }),
);
const logger = createLogger({ service: 'signer', level: env.LOG_LEVEL });
const database = connect(env.DATABASE_URL);
const urls = { devnet: env.SIGNER_RPC_DEVNET.split(','), mainnet: env.SIGNER_RPC_MAINNET.split(',') };

runService({
  app: buildApp(logger, {
    db: database.db,
    ring: keyRingFromEnv({ APERTURE_KEK_V1: env.SIGNER_KEK_V1 }),
    rpcFor: (network: SolanaNetwork) => solanaRpc(urls[network]),
    sharedSecret: env.SIGNER_SHARED_SECRET,
  }),
  port: env.PORT,
  logger,
  onShutdown: () => database.close(),
});
