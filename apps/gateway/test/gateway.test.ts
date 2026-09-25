import { json } from '@aperture/connectors/testing';
import { eq, schema } from '@aperture/db';
import { usd } from '@aperture/db/testing';
import { signWorkspaceToken } from '@aperture/crypto';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PEPPER,
  UPSTREAM_KEY,
  createGatewayHarness,
  gateway,
  ledgerOf,
  requestsOf,
  seedGatewayOrg,
  sse,
  type GatewayHarness,
} from './harness';

let h: GatewayHarness;
beforeAll(async () => {
  h = await createGatewayHarness();
});
afterAll(async () => {
  await h.close();
});

const chat = { model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 };
const completion = (cost = 0.000123) => ({
  id: 'gen-1',
  choices: [{ message: { role: 'assistant', content: 'hello' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, cost },
});

describe('authentication', () => {
  it('rejects missing, malformed and unknown keys in the caller’s SDK error shape', async () => {
    const { call, app, upstream } = gateway(h, {});
    expect((await app.request('/v1/chat/completions', { method: 'POST', body: '{}' })).status).toBe(401);
    const unknown = await call('/v1/chat/completions', 'apk_test_' + 'x'.repeat(43), chat);
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ error: { type: 'aperture_unauthorized' } });
    const anthropic = await call('/anthropic/v1/messages', 'nope', {});
    expect(await anthropic.json()).toMatchObject({ type: 'error', error: { type: 'aperture_unauthorized' } });
    expect(upstream.calls).toHaveLength(0);
  });

  it('stops accepting a key the moment it is revoked', async () => {
    const org = await seedGatewayOrg(h);
    const { call } = gateway(h, { 'POST /api/v1/chat/completions': json(completion()) });
    expect((await call('/v1/chat/completions', org.key, chat)).status).toBe(200);
    await h.system.db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.id, org.apiKeyId));
    expect((await call('/v1/chat/completions', org.key, chat)).status).toBe(401);
  });

  it('accepts short-lived workspace tokens bound to one principal', async () => {
    const org = await seedGatewayOrg(h);
    const { call } = gateway(h, { 'POST /api/v1/chat/completions': json(completion()) });
    const token = signWorkspaceToken(
      { orgId: org.org.id, principalId: org.agent.id, exp: Math.floor(Date.now() / 1000) + 300 },
      PEPPER,
    );
    expect((await call('/v1/chat/completions', token, chat)).status).toBe(200);
    const expired = signWorkspaceToken(
      { orgId: org.org.id, principalId: org.agent.id, exp: Math.floor(Date.now() / 1000) - 1 },
      PEPPER,
    );
    expect((await call('/v1/chat/completions', expired, chat)).status).toBe(401);
  });
});

describe('allowed requests', () => {
  it('forwards with the org’s upstream key, caps output, and settles the exact cost', async () => {
    const org = await seedGatewayOrg(h);
    const { call, upstream } = gateway(h, { 'POST /api/v1/chat/completions': json(completion(0.000123)) });
    const response = await call('/v1/chat/completions', org.key, { ...chat, max_tokens: undefined });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'hello' } }] });
    expect(response.headers.get('x-aperture-cost-usd')).toBe('0.000123');
    expect(response.headers.get('x-aperture-budget-remaining-usd')).toBe('0.999877');

    const sent = upstream.calls[0];
    expect(sent?.url.toString()).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(sent?.body).toMatchObject({ model: 'openai/gpt-4o-mini', max_tokens: 4096 });

    const entries = await ledgerOf(h, org.org.id);
    expect(entries.find((e) => e.kind === 'capture')?.amount).toBe(123n);
    const [logged] = await requestsOf(h, org.org.id);
    expect(logged).toMatchObject({ outcome: 'allowed', cost: 123n, inputTokens: 10, outputTokens: 5, stream: false });
  });

  it('streams bytes through unchanged and settles from the final usage event', async () => {
    const org = await seedGatewayOrg(h);
    const body = sse([
      { id: 'gen-2', choices: [{ delta: { content: 'Hel' } }] },
      { id: 'gen-2', choices: [{ delta: { content: 'lo' } }] },
      { id: 'gen-2', choices: [], usage: { prompt_tokens: 8, completion_tokens: 2, cost: 0.00005 } },
    ]);
    const { call, upstream } = gateway(h, {
      'POST /api/v1/chat/completions': () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    });
    const response = await call('/v1/chat/completions', org.key, { ...chat, stream: true });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe(body);
    expect(upstream.calls[0]?.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });

    await expect.poll(async () => (await ledgerOf(h, org.org.id)).find((e) => e.kind === 'capture')?.amount).toBe(50n);
  });

  it('parses Anthropic and Gemini usage from their own formats', async () => {
    const org = await seedGatewayOrg(h);
    const { call, upstream } = gateway(h, {
      'POST /v1/messages': json({ content: [], usage: { input_tokens: 1000, output_tokens: 100 } }),
      'POST /v1beta/models/gemini-2.5-flash:generateContent': json({
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 50 },
      }),
    });
    const anthropic = await call(
      '/anthropic/v1/messages',
      org.key,
      { model: 'claude-sonnet-4-5-20250929', max_tokens: 200, messages: [] },
      { 'x-api-key': org.key },
    );
    expect(anthropic.status).toBe(200);
    expect(anthropic.headers.get('x-aperture-cost-usd')).toBe('0.0045'); // 1000×3 + 100×15 per M
    expect(upstream.calls[0]?.headers.get('x-api-key')).toBe('sk-ant-gateway');

    const gemini = await call('/google/v1beta/models/gemini-2.5-flash:generateContent', org.key, { contents: [] });
    expect(gemini.status).toBe(200);
    expect(gemini.headers.get('x-aperture-cost-usd')).toBe('0.00055'); // 1000×0.30 + 100×2.50 per M
    expect(upstream.calls[1]?.headers.get('x-goog-api-key')).toBe('AIza-gemini-key');
    expect(upstream.calls[1]?.body).toMatchObject({ generationConfig: { maxOutputTokens: 4096 } });
  });
});

describe('denials never reach the provider', () => {
  it('denies by policy with the rule, before any upstream call', async () => {
    const org = await seedGatewayOrg(h);
    await h.system.db.insert(schema.policies).values({
      id: crypto.randomUUID(),
      orgId: org.org.id,
      scope: 'org',
      scopeId: org.org.id,
      version: 1,
      document: { rules: [{ id: 'no-gpt', type: 'deny_models', patterns: ['openai/*'] }] },
      createdBy: (await h.system.db.select().from(schema.users).limit(1))[0]?.id ?? '',
    });
    const { call, upstream } = gateway(h, { 'POST /api/v1/chat/completions': json(completion()) });
    const response = await call('/v1/chat/completions', org.key, chat);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { type: 'aperture_policy_denied' } });
    expect(upstream.calls).toHaveLength(0);
  });

  it('denies when the budget can’t cover the estimate, naming the budget', async () => {
    const org = await seedGatewayOrg(h, { agent: '0.0001' });
    const { call, upstream } = gateway(h, { 'POST /api/v1/chat/completions': json(completion()) });
    const response = await call('/v1/chat/completions', org.key, { ...chat, max_tokens: 10_000 });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: { type: 'aperture_budget_exceeded', budget: 'research-bot daily' },
    });
    expect(upstream.calls).toHaveLength(0);
    expect((await requestsOf(h, org.org.id))[0]).toMatchObject({ outcome: 'denied_budget' });
  });

  it('denies unpriced models and paused agents (kill switch)', async () => {
    const org = await seedGatewayOrg(h);
    const { call, upstream } = gateway(h, { 'POST /api/v1/chat/completions': json(completion()) });
    expect((await call('/v1/chat/completions', org.key, { ...chat, model: 'mystery/model' })).status).toBe(403);
    await h.system.db.update(schema.principals).set({ status: 'paused' }).where(eq(schema.principals.id, org.agent.id));
    const paused = await call('/v1/chat/completions', org.key, chat);
    expect(paused.status).toBe(403);
    expect(await paused.json()).toMatchObject({ error: { type: 'aperture_principal_inactive' } });
    expect(upstream.calls).toHaveLength(0);
  });

  it('INV-13: fuzzed bodies under a deny-all policy never produce an upstream byte or a 5xx', async () => {
    const org = await seedGatewayOrg(h);
    await h.system.db.insert(schema.policies).values({
      id: crypto.randomUUID(),
      orgId: org.org.id,
      scope: 'principal',
      scopeId: org.agent.id,
      version: 1,
      document: { rules: [{ id: 'none', type: 'allow_rails', rails: ['card'] }] },
      createdBy: (await h.system.db.select().from(schema.users).limit(1))[0]?.id ?? '',
    });
    const { call, upstream } = gateway(h, {});
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          '/v1/chat/completions',
          '/v1/embeddings',
          '/v1/responses',
          '/anthropic/v1/messages',
          '/google/v1beta/models/gemini-2.5-flash:generateContent',
        ),
        fc.oneof(
          fc.jsonValue(),
          fc.record({
            model: fc.constantFrom('openai/gpt-4o-mini', 'claude-sonnet-4-5', ''),
            stream: fc.boolean(),
            max_tokens: fc.integer(),
          }),
        ),
        async (path, body) => {
          const response = await call(path, org.key, body);
          expect(response.status).toBeLessThan(500);
          expect(response.status).toBeGreaterThanOrEqual(400);
        },
      ),
      { numRuns: 60 },
    );
    expect(upstream.calls).toHaveLength(0);
  });
});

describe('upstream failures', () => {
  it('passes 429s through and releases the hold, so nothing is charged', async () => {
    const org = await seedGatewayOrg(h);
    const { call } = gateway(h, {
      'POST /api/v1/chat/completions': json({ error: { message: 'rate limited' } }, 429, { 'retry-after': '3' }),
    });
    const response = await call('/v1/chat/completions', org.key, chat);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3');
    const kinds = (await ledgerOf(h, org.org.id)).map((e) => e.kind).sort();
    expect(kinds).toEqual(['hold', 'release']);
  });

  it('settles what was used when the client disconnects mid-stream (G3)', async () => {
    const org = await seedGatewayOrg(h);
    const encoder = new TextEncoder();
    let upstreamCancelled = false;
    const { call } = gateway(h, {
      'POST /api/v1/chat/completions': () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`),
              );
            },
            cancel() {
              upstreamCancelled = true;
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    const response = await call('/v1/chat/completions', org.key, { ...chat, stream: true });
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    await expect.poll(async () => (await ledgerOf(h, org.org.id)).some((e) => e.kind === 'capture')).toBe(true);
    expect(upstreamCancelled).toBe(true);
    // No usage arrived, so the reservation (the most it could have cost) is charged.
    const hold = (await ledgerOf(h, org.org.id)).find((e) => e.kind === 'hold');
    expect((await ledgerOf(h, org.org.id)).find((e) => e.kind === 'capture')?.amount).toBe(hold?.amount);
    expect((await requestsOf(h, org.org.id))[0]?.outcome).toBe('client_disconnected');
  });

  it('keeps budgets exact under concurrent requests on one small budget', async () => {
    const org = await seedGatewayOrg(h, { agent: '0.01' });
    const { call } = gateway(h, { 'POST /api/v1/chat/completions': json(completion(0.001)) });
    // Each request reserves ~$0.00006 for 100 output tokens and settles $0.001.
    const results = await Promise.all(Array.from({ length: 30 }, () => call('/v1/chat/completions', org.key, chat)));
    // 402 once the budget is used up; 429 when more than 20 run at once for one key.
    expect(results.every((r) => [200, 402, 429].includes(r.status))).toBe(true);
    const captured = (await ledgerOf(h, org.org.id))
      .filter((e) => e.kind === 'capture')
      .reduce((sum, e) => sum + e.amount, 0n);
    expect(captured).toBe(BigInt(results.filter((r) => r.status === 200).length) * usd('0.001'));
  });
});
