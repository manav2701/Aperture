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

describe('metrics (Phase 10)', () => {
  it('counts requests by route pattern and only serves /metrics with the token', async () => {
    const { metrics, metricsMiddleware } = await import('./metrics');
    metrics.reset();
    const { Hono } = await import('hono');
    const app = new Hono();
    app.use('*', metricsMiddleware());
    app.route('/', createServiceApp({ service: 'test', logger: createLogger({ service: 'test', level: 'silent' }) }));
    app.get('/items/:id', (c) => c.json({ id: c.req.param('id') }));
    await app.request('/items/123');
    await app.request('/items/456');
    expect((await app.request('/metrics')).status).toBe(404);
    process.env.METRICS_TOKEN = 'metrics-token';
    const scraped = await app.request('/metrics', { headers: { authorization: 'Bearer metrics-token' } });
    delete process.env.METRICS_TOKEN;
    const text = await scraped.text();
    expect(text).toContain('aperture_http_requests_total{method="GET",route="/items/:id",status="200"} 2');
    expect(text).toContain('aperture_http_request_duration_ms_count{route="/items/:id"} 2');
    expect(text).not.toContain('123');
  });
});
