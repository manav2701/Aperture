import { Hono } from 'hono';
import type { Logger } from './logger';

export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
}

export interface ServiceAppOptions {
  service: string;
  logger: Logger;
  readinessChecks?: readonly ReadinessCheck[];
  readinessTimeoutMs?: number;
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Base Hono app for every service: `/healthz` answers whether the process is up,
 * `/readyz` whether its dependencies (database, etc.) are reachable. Failure details are
 * logged, never returned, so the endpoints are safe to expose to load balancers.
 */
export function createServiceApp({
  service,
  logger,
  readinessChecks = [],
  readinessTimeoutMs = 2_000,
}: ServiceAppOptions): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok', service }));

  app.get('/readyz', async (c) => {
    const checks = await Promise.all(
      readinessChecks.map(async ({ name, check }) => {
        try {
          await withTimeout(check(), readinessTimeoutMs);
          return { name, ok: true };
        } catch (error) {
          logger.warn({ err: error, check: name }, 'readiness check failed');
          return { name, ok: false };
        }
      }),
    );
    const ready = checks.every((result) => result.ok);
    return c.json({ status: ready ? 'ready' : 'not_ready', service, checks }, ready ? 200 : 503);
  });

  return app;
}
