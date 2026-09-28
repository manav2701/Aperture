import type { Database } from '@aperture/db';
import { schema } from '@aperture/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { magicLink, twoFactor } from 'better-auth/plugins';
import { eq } from '@aperture/db';
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
        twoFactor: schema.twoFactors,
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
      // TOTP with backup codes (Phase 10). Required for owners, admins and finance before they
      // change anything (see requireUser / accessMiddleware).
      twoFactor({ issuer: 'Aperture' }),
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
    databaseHooks: {
      session: {
        create: {
          // The two-factor plugin only guards password sign-in. Someone who turned it on must
          // not get a session from a magic link or Google without their second factor.
          before: async (session, context) => {
            const path = context?.path ?? '';
            if (!path.startsWith('/magic-link/verify') && !path.startsWith('/callback/')) return;
            const [user] = await db
              .select({ twoFactorEnabled: schema.users.twoFactorEnabled })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId));
            if (user?.twoFactorEnabled === true) {
              throw new APIError('FORBIDDEN', {
                message: 'Two-factor is on for this account: sign in with your password and authenticator code.',
              });
            }
          },
        },
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
