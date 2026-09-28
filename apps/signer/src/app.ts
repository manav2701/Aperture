import { createServiceApp, type Logger } from '@aperture/runtime';
import { Hono } from 'hono';
import { z } from 'zod';
import { SignerRefusal, createDelegateKey, sharedSecretMatches, signPayment, type SignerDeps } from './signer';

/*
 * Internal-only HTTP (plan/phases/phase-09 §9.2): reachable on the private network only, and
 * every call carries the shared secret. Refusals are 409 with a code, never a signature.
 */

const ids = z.object({ orgId: z.uuid(), accountId: z.uuid().optional(), paymentId: z.uuid().optional() });

export function buildApp(logger: Logger, deps?: SignerDeps & { sharedSecret: string }) {
  const app = new Hono();
  app.route('/', createServiceApp({ service: 'signer', logger }));
  if (deps === undefined) return app;

  app.use('/v1/*', async (c, next) => {
    if (!sharedSecretMatches(deps.sharedSecret, c.req.header('authorization')))
      return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  const handle =
    (run: (body: z.infer<typeof ids>) => Promise<Record<string, unknown>>) =>
    async (c: {
      req: { json: () => Promise<unknown> };
      json: (body: unknown, status?: 200 | 400 | 409 | 500) => Response;
    }) => {
      const parsed = ids.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
      try {
        return c.json(await run(parsed.data));
      } catch (error) {
        if (error instanceof SignerRefusal) {
          logger.warn({ code: error.code, orgId: parsed.data.orgId }, 'signer refused');
          return c.json({ error: error.code, message: error.message }, 409);
        }
        logger.error({ err: error }, 'signer failed');
        return c.json({ error: 'internal' }, 500);
      }
    };

  app.post(
    '/v1/keys',
    handle(async ({ orgId, accountId }) => ({
      delegate: await createDelegateKey(deps, { orgId, accountId: accountId ?? '' }),
    })),
  );
  app.post(
    '/v1/sign',
    handle(async ({ orgId, paymentId }) => {
      const signed = await signPayment(deps, { orgId, paymentId: paymentId ?? '' });
      return { transaction: signed.transaction, lastValidBlockHeight: signed.lastValidBlockHeight.toString() };
    }),
  );
  return app;
}
