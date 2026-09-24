import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect, defaultMigrationsFolder, runMigrations } from '@aperture/db';
import { createLogger, loadEnvOrExit, runService } from '@aperture/runtime';
import { buildApp } from './app';
import { createAuth } from './auth';
import { logSender, resendSender } from './email';
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

const database = connect(env.DATABASE_URL);
const email =
  env.RESEND_API_KEY === undefined
    ? logSender(logger)
    : resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, logger });
const auth = createAuth({ db: database.db, env, email });
const { app } = buildApp({ db: database.db, auth, email, logger, webOrigin: env.WEB_ORIGIN });

runService({ app, port: env.PORT, logger, onShutdown: database.close });
