import { serviceEnvSchema } from '@aperture/runtime';
import { z } from 'zod';

const optional = z.string().min(1).optional();

export const apiEnvSchema = serviceEnvSchema(4000).extend({
  /** App connection: a non-superuser role in aperture_app, so row-level security applies. */
  DATABASE_URL: z.url(),
  /** Owner connection used only to apply migrations; falls back to DATABASE_URL. */
  DATABASE_MIGRATION_URL: z.url().optional(),
  /** Apply pending migrations at startup (staging on hosts without a pre-deploy step). */
  RUN_MIGRATIONS: z.stringbool().default(false),
  /** Public origin of the web app; also Better Auth's base URL (requests arrive via its /api proxy). */
  WEB_ORIGIN: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  /** Without it, emails are written to the log (development only). */
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().min(3).default('Aperture <onboarding@resend.dev>'),
});

export type ApiEnv = z.output<typeof apiEnvSchema>;
