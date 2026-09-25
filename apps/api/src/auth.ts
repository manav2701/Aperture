import type { Database } from '@aperture/db';
import { schema } from '@aperture/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { v7 as uuidv7 } from 'uuid';
import type { EmailSender } from '@aperture/runtime';
import { emails } from './email';
import type { ApiEnv } from './env';

/**
 * Authentication only: who you are. What you may do in an org (members, roles, teams) is
 * Aperture's own model in the control-plane routes, not a Better Auth plugin.
 */
export function createAuth(options: {
  db: Database;
  env: Pick<ApiEnv, 'NODE_ENV' | 'WEB_ORIGIN' | 'BETTER_AUTH_SECRET' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>;
  email: EmailSender;
}) {
  const { db, env, email } = options;
  const production = env.NODE_ENV === 'production';
  const google =
    env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};

  return betterAuth({
    appName: 'Aperture',
    baseURL: env.WEB_ORIGIN,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        rateLimit: schema.rateLimits,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => {
        await email.send({ to: user.email, ...emails.resetPassword(url) });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Signing in unverified re-sends the link, so a lost first email never locks anyone out.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await email.send({ to: user.email, ...emails.verify(url) });
      },
    },
    socialProviders: google,
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email: to, url }) => {
          await email.send({ to, ...emails.magicLink(url) });
        },
      }),
    ],
    rateLimit: {
      enabled: production,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/sign-in/magic-link': { window: 60, max: 5 },
        '/forget-password': { window: 60, max: 3 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      cookiePrefix: 'aperture',
      useSecureCookies: production,
      database: { generateId: () => uuidv7() },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
