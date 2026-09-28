import { keyRingFromEnv } from '@aperture/crypto';
import { connect } from '@aperture/db';
import { storageFromEnv } from '@aperture/media';
import { createLogger, loadEnvOrExit, runService, serviceEnvSchema } from '@aperture/runtime';
import { z } from 'zod';
import { buildApp } from './app';
import { GatewayCache } from './context';
import { listenForInvalidation } from './invalidation';
import { RequestLimiter } from './limits';
import { httpSigner } from './x402';

const env = loadEnvOrExit(
  serviceEnvSchema(4100).extend({
    /** Non-owner app role, like the API. */
    DATABASE_URL: z.url(),
    /** Same value as the API's: gateway keys are HMACs under it. */
    APERTURE_KEY_PEPPER: z.string().min(32),
    /** The x402 signer on the private network; x402 payments are off without both. */
    SIGNER_URL: z.url().optional(),
    SIGNER_SHARED_SECRET: z.string().min(32).optional(),
  }),
);
const logger = createLogger({ service: 'gateway', level: env.LOG_LEVEL });
const database = connect(env.DATABASE_URL);
const cache = new GatewayCache();
const stopListening = listenForInvalidation(database, cache, logger);

const app = buildApp({
  db: database.db,
  ring: keyRingFromEnv(process.env),
  pepper: env.APERTURE_KEY_PEPPER,
  workspaceSecret: env.APERTURE_KEY_PEPPER,
  logger,
  cache,
  limiter: new RequestLimiter(),
  storage: storageFromEnv(process.env),
  signer:
    env.SIGNER_URL === undefined || env.SIGNER_SHARED_SECRET === undefined
      ? undefined
      : httpSigner(env.SIGNER_URL, env.SIGNER_SHARED_SECRET),
});

runService({
  app,
  port: env.PORT,
  logger,
  onShutdown: async () => {
    await stopListening();
    await database.close();
  },
});
