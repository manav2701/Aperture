import { json } from '@aperture/connectors/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestLimiter } from '../src/limits';
import { createGatewayHarness, gateway, seedGatewayOrg, type GatewayHarness } from './harness';

/*
 * Gateway overhead under load (plan/phases/phase-10 §10.5; budgets in plan/architecture §20).
 * The upstream is an instant fake, so every millisecond measured is Aperture's own:
 * authentication, policy, estimate, reserve, settle, request log. Run with PERF=1:
 *   PERF=1 pnpm --filter @aperture/gateway exec vitest run test/load.perf.test.ts
 */

const run = process.env.PERF === '1';
let h: GatewayHarness;

beforeAll(async () => {
  if (run) h = await createGatewayHarness();
}, 120_000);
afterAll(async () => {
  if (run) await h.close();
});

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

describe.skipIf(!run)('gateway load', () => {
  it('sustains concurrent chat completions and reports overhead percentiles', async () => {
    if (process.env.PERF_ASYNC_COMMIT === '1') {
      // Diagnostic only: separates commit-fsync cost (the disk) from query work.
      const { sql } = await import('@aperture/db');
      await h.system.db.execute(
        sql.raw(`alter database ${new URL(h.system.url).pathname.slice(1)} set synchronous_commit = off`),
      );
    }
    const org = await seedGatewayOrg(h, { agent: '100000' });
    const completion = {
      id: 'gen',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0.000001 },
    };
    // Rate limits off: this measures Aperture's per-request overhead, not the limiter.
    const limiter = new RequestLimiter({ perKeyPerMinute: 1e9, perKeyConcurrency: 1e6, perOrgConcurrency: 1e6 });
    const { call } = gateway(h, { 'POST /api/v1/chat/completions': json(completion) }, { limiter });
    const body = { model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 };

    const concurrency = Number(process.env.PERF_CONCURRENCY ?? 32);
    const seconds = Number(process.env.PERF_SECONDS ?? 10);
    const latencies: number[] = [];
    let errors = 0;
    const statuses: Record<number, number> = {};
    const deadline = Date.now() + seconds * 1000;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (Date.now() < deadline) {
          const started = performance.now();
          const response = await call('/v1/chat/completions', org.key, body);
          await response.arrayBuffer();
          latencies.push(performance.now() - started);
          if (response.status !== 200) {
            errors += 1;
            statuses[response.status] = (statuses[response.status] ?? 0) + 1;
          }
        }
      }),
    );
    latencies.sort((a, b) => a - b);
    // One database round trip on this machine, to express overhead in round trips.
    const { sql } = await import('@aperture/db');
    const rttStarted = performance.now();
    for (let i = 0; i < 50; i += 1) await h.app.db.execute(sql`select 1`);
    const rtt = (performance.now() - rttStarted) / 50;
    const result = {
      concurrency,
      requests: latencies.length,
      rps: Math.round(latencies.length / seconds),
      p50: percentile(latencies, 50).toFixed(1),
      p95: percentile(latencies, 95).toFixed(1),
      p99: percentile(latencies, 99).toFixed(1),
      errors,
      statuses,
      dbRoundTripMs: rtt.toFixed(2),
      p50InRoundTrips: (percentile(latencies, 50) / rtt).toFixed(1),
    };
    process.stdout.write(`\nGATEWAY LOAD ${JSON.stringify(result)}\n`);
    expect(errors).toBe(0);
  }, 180_000);
});
