import { createLogger } from '@aperture/runtime';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('worker app', () => {
  it('reports healthy under its own service name', async () => {
    const app = buildApp(createLogger({ service: 'worker', level: 'silent' }));
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'worker' });
  });
});
