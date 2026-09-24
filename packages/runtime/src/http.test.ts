import { describe, expect, it } from 'vitest';
import { createServiceApp } from './http';
import { createLogger } from './logger';

const logger = createLogger({ service: 'test', level: 'silent' });

describe('createServiceApp', () => {
  it('answers /healthz with the service name', async () => {
    const app = createServiceApp({ service: 'api', logger });
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'api' });
  });

  it('reports ready when every check passes', async () => {
    const app = createServiceApp({
      service: 'api',
      logger,
      readinessChecks: [{ name: 'database', check: () => Promise.resolve() }],
    });
    const response = await app.request('/readyz');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready', checks: [{ name: 'database', ok: true }] });
  });

  it('returns 503 without leaking the failure reason', async () => {
    const app = createServiceApp({
      service: 'api',
      logger,
      readinessChecks: [{ name: 'database', check: () => Promise.reject(new Error('password authentication failed')) }],
    });
    const response = await app.request('/readyz');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('password');
  });

  it('fails a check that hangs past the timeout', async () => {
    const app = createServiceApp({
      service: 'api',
      logger,
      readinessTimeoutMs: 20,
      readinessChecks: [{ name: 'slow', check: () => new Promise(() => undefined) }],
    });
    const response = await app.request('/readyz');
    expect(response.status).toBe(503);
  });
});
