import { keyRingFromEnv } from '@aperture/crypto';
import { connect } from '@aperture/db';
import { startStandardJobs } from '@aperture/jobs';
import { createLogger, loadEnvOrExit, logSender, resendSender, runService, serviceEnvSchema } from '@aperture/runtime';
import { z } from 'zod';
import { buildApp } from './app';

const env = loadEnvOrExit(
  serviceEnvSchema(4200).extend({
    /** Non-owner app role, like the API. */
    DATABASE_URL: z.url(),
    /** Public web origin, for links in alert emails. */
    WEB_ORIGIN: z.url(),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).default('Aperture <onboarding@resend.dev>'),
  }),
);
const logger = createLogger({ service: 'worker', level: env.LOG_LEVEL });
const database = connect(env.DATABASE_URL);
const email =
  env.RESEND_API_KEY === undefined
    ? logSender(logger)
    : resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, logger });
const scheduler = startStandardJobs({
  database,
  ring: keyRingFromEnv(process.env),
  logger,
  email,
  webOrigin: env.WEB_ORIGIN,
});

runService({
  app: buildApp(logger),
  port: env.PORT,
  logger,
  onShutdown: async () => {
    await scheduler.stop();
    await database.close();
  },
});
