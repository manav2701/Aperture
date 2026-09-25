import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keyRingFromEnv } from '@aperture/crypto';
import { connect, defaultMigrationsFolder, runMigrations } from '@aperture/db';
import { GatewayCache, RequestLimiter, buildGatewayApp, listenForInvalidation } from '@aperture/gateway';
import { startStandardJobs, type JobDeps } from '@aperture/jobs';
import { createLogger, loadEnvOrExit, logSender, resendSender, runService } from '@aperture/runtime';
import { buildApp } from './app';
import { createAuth } from './auth';
import { apiEnvSchema } from './env';

const env = loadEnvOrExit(apiEnvSchema);
const logger = createLogger({ service: 'api', level: env.LOG_LEVEL });

if (env.NODE_ENV === 'production' && env.RESEND_API_KEY === undefined) {
  logger.fatal('RESEND_API_KEY is required in production (emails would otherwise only be logged)');
  process.exit(1);
}

if (env.RUN_MIGRATIONS) {
  // The production bundle carries its own copy of the migrations next to it (see tools/build-service.mjs).
  const bundled = fileURLToPath(new URL('./migrations', import.meta.url));
  const folder = existsSync(bundled) ? bundled : defaultMigrationsFolder();
  const migrator = connect(env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL, { max: 1 });
  try {
    await runMigrations(migrator.db, folder);
    logger.info('migrations applied');
  } finally {
    await migrator.close();
  }
}

const ring = keyRingFromEnv(process.env);
const database = connect(env.DATABASE_URL);
const email =
  env.RESEND_API_KEY === undefined
    ? logSender(logger)
    : resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, logger });
const jobs: JobDeps = { database, ring, logger, email, webOrigin: env.WEB_ORIGIN };

// Hosts without separate worker and gateway services run them in this process.
const cache = new GatewayCache();
const gateway = env.EMBED_GATEWAY
  ? buildGatewayApp({
      db: database.db,
      ring,
      pepper: env.APERTURE_KEY_PEPPER,
      workspaceSecret: env.APERTURE_KEY_PEPPER,
      logger: logger.child({ component: 'gateway' }),
      cache,
      limiter: new RequestLimiter(),
    })
  : undefined;
const stopListening = gateway === undefined ? undefined : listenForInvalidation(database, cache, logger);
const scheduler = env.RUN_WORKER ? startStandardJobs(jobs) : undefined;

const auth = createAuth({ db: database.db, env, email });
const { app } = buildApp(
  {
    db: database.db,
    auth,
    email,
    logger,
    webOrigin: env.WEB_ORIGIN,
    ring,
    pepper: env.APERTURE_KEY_PEPPER,
    jobs,
    gateway,
    gatewayPublicUrl: env.GATEWAY_PUBLIC_URL,
  },
  gateway,
);

runService({
  app,
  port: env.PORT,
  logger,
  onShutdown: async () => {
    await scheduler?.stop();
    await stopListening?.();
    await database.close();
  },
});
