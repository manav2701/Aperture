import { generateKeyPairSync } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ConnectorError,
  connectorFor,
  decimalToScaled,
  dollarsToMicros,
  fetchPriceCatalog,
  normalizeModel,
  type Provider,
} from '../src/index';
import { fakeProvider, json, noSleep } from './fake-fetch';

const orKey = (overrides: Record<string, unknown> = {}) => ({
  hash: 'hash-1',
  name: 'aperture:alice',
  label: 'sk-or-v1-abc...xyz',
  disabled: false,
  usage: 0.123456789,
  limit: 2.5,
  ...overrides,
});

describe('OpenRouter connector', () => {
  it('accepts only management keys', async () => {
    const provider = fakeProvider({ 'GET /api/v1/key': json({ data: { is_management_key: false, label: 'x' } }) });
    const connector = connectorFor('openrouter', { secret: 'sk-or', config: {}, fetch: provider.fetch });
    await expect(connector.test()).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists keys across pages, converting dollars to µUSD', async () => {
    const provider = fakeProvider({
      'GET /api/v1/key': json({ data: { is_management_key: true, organization_id: 'org_1' } }),
      'GET /api/v1/keys': [
        json({ data: [orKey(), orKey({ hash: 'hash-2', limit: null })] }),
        json({ data: [] }),
        json({ data: [orKey(), orKey({ hash: 'hash-2', limit: null })] }),
        json({ data: [] }),
      ],
    });
    const connector = connectorFor('openrouter', { secret: 'sk-or-mgmt', config: {}, fetch: provider.fetch });
    const health = await connector.test();
    expect(health).toEqual({ fingerprint: 'org_1', details: { keys: 2 } });
    const keys = await connector.listKeys();
    expect(keys[0]).toMatchObject({ externalId: 'hash-1', usage: 123_457n, limit: 2_500_000n });
    expect(keys[1]?.limit).toBeNull();
    expect(provider.calls[0]?.headers.get('authorization')).toBe('Bearer sk-or-mgmt');
    expect(
      provider.calls.filter((c) => c.url.pathname === '/api/v1/keys').map((c) => c.url.searchParams.get('offset')),
    ).toEqual(['0', '2', '0', '2']);
  });

  it('creates keys with a hard limit and no UTC reset, mirrors limits, and disables on revoke', async () => {
    const provider = fakeProvider({
      'POST /api/v1/keys': json({ data: orKey({ usage: 0, limit: 1.25 }), key: 'sk-or-v1-secret' }),
      'PATCH /api/v1/keys/hash-1': json({ data: orKey() }),
    });
    const connector = connectorFor('openrouter', { secret: 'm', config: {}, fetch: provider.fetch });
    const created = await connector.createKey?.('aperture:alice', 1_250_000n);
    expect(created?.secret).toBe('sk-or-v1-secret');
    expect(provider.calls[0]?.body).toEqual({ name: 'aperture:alice', limit: 1.25, limit_reset: null });

    await connector.setLimit?.('hash-1', 3_000_001n);
    await connector.revoke('hash-1');
    expect(provider.calls.slice(1).map((c) => c.body)).toEqual([{ limit: 3.000001 }, { disabled: true }]);
  });
});

describe('HTTP client', () => {
  it('retries 429 and 5xx, honouring Retry-After, then succeeds', async () => {
    const delays: number[] = [];
    const provider = fakeProvider({
      'GET /api/v1/keys': [
        json({ error: 'slow down' }, 429, { 'retry-after': '2' }),
        json({ error: 'oops' }, 503),
        json({ data: [] }),
      ],
    });
    const connector = connectorFor('openrouter', {
      secret: 'm',
      config: {},
      fetch: provider.fetch,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    expect(await connector.listKeys()).toEqual([]);
    expect(delays[0]).toBe(2000);
    expect(delays).toHaveLength(2);
  });

  it('does not retry client errors and reports a typed error', async () => {
    const provider = fakeProvider({ 'GET /api/v1/keys': json({ error: 'bad key' }, 401) });
    const connector = connectorFor('openrouter', { secret: 'm', config: {}, fetch: provider.fetch, sleep: noSleep });
    await expect(connector.listKeys()).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    expect(provider.calls).toHaveLength(1);
  });

  it('gives up after repeated outages', async () => {
    const provider = fakeProvider({ 'GET /api/v1/keys': json({}, 502) });
    const connector = connectorFor('openrouter', { secret: 'm', config: {}, fetch: provider.fetch, sleep: noSleep });
    await expect(connector.listKeys()).rejects.toMatchObject({ code: 'unavailable' });
    expect(provider.calls).toHaveLength(4);
  });
});

describe('OpenAI connector', () => {
  const connector = (fetch: ReturnType<typeof fakeProvider>['fetch']) =>
    connectorFor('openai', { secret: 'sk-admin', config: { projectId: 'proj_1' }, fetch, sleep: noSleep });

  it('imports minute buckets by key and model, separating cached input', async () => {
    const provider = fakeProvider({
      'GET /v1/organization/usage/completions': [
        json({
          data: [
            {
              start_time: 1_790_000_000,
              end_time: 1_790_000_060,
              result: [
                {
                  input_tokens: 1000,
                  input_cached_tokens: 400,
                  output_tokens: 50,
                  api_key_id: 'key_a',
                  model: 'gpt-4o-mini-2024-07-18',
                },
                { input_tokens: 5, output_tokens: 5, api_key_id: null, model: 'gpt-4o-mini' },
              ],
            },
          ],
          has_more: true,
          next_page: 'p2',
        }),
        json({ data: [], has_more: false, next_page: null }),
      ],
    });
    const records = await connector(provider.fetch).usageSince?.(new Date(1_790_000_000_000));
    expect(records).toEqual([
      {
        externalKeyId: 'key_a',
        model: 'gpt-4o-mini-2024-07-18',
        bucketStart: new Date(1_790_000_000_000),
        bucketEnd: new Date(1_790_000_060_000),
        inputTokens: 600n,
        outputTokens: 50n,
        cacheReadTokens: 400n,
        cacheWriteTokens: 0n,
      },
    ]);
    const first = provider.calls[0]?.url.searchParams;
    expect(first?.getAll('group_by')).toEqual(['api_key_id', 'model']);
    expect(first?.get('project_ids')).toBe('proj_1');
    expect(provider.calls[1]?.url.searchParams.get('page')).toBe('p2');
  });

  it('creates a service account per principal and deletes its key on revoke', async () => {
    const provider = fakeProvider({
      'POST /v1/organization/projects/proj_1/service_accounts': json({
        id: 'svc_1',
        api_key: { id: 'key_1', value: 'sk-svcacct-full-secret', name: 'x' },
      }),
      'DELETE /v1/organization/projects/proj_1/api_keys/key_1': json({ id: 'key_1', deleted: true }),
    });
    const created = await connector(provider.fetch).createKey?.('aperture:bob', null);
    expect(created).toMatchObject({
      secret: 'sk-svcacct-full-secret',
      key: { externalId: 'key_1', hint: 'sk-svcac…' },
    });
    await connector(provider.fetch).revoke('key_1');
    expect(provider.calls.map((c) => `${c.method} ${c.url.pathname}`)).toContain(
      'DELETE /v1/organization/projects/proj_1/api_keys/key_1',
    );
  });

  it('requires a project', async () => {
    const bare = connectorFor('openai', { secret: 's', config: {}, fetch: fakeProvider({}).fetch });
    await expect(bare.listKeys()).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('Anthropic connector', () => {
  it('imports usage with cache writes summed, and sets keys inactive on revoke', async () => {
    const provider = fakeProvider({
      'GET /v1/organizations/usage_report/messages': json({
        data: [
          {
            starting_at: '2026-09-25T10:00:00Z',
            ending_at: '2026-09-25T10:01:00Z',
            results: [
              {
                api_key_id: 'apikey_1',
                model: 'claude-sonnet-4-5-20250929',
                uncached_input_tokens: 100,
                cache_read_input_tokens: 20,
                cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 4 },
                output_tokens: 9,
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
      'POST /v1/organizations/api_keys/apikey_1': json({ id: 'apikey_1', status: 'inactive' }),
    });
    const connector = connectorFor('anthropic', { secret: 'sk-ant-admin', config: {}, fetch: provider.fetch });
    const [record] = (await connector.usageSince?.(new Date('2026-09-25T10:00:00Z'))) ?? [];
    expect(record).toMatchObject({ inputTokens: 100n, cacheReadTokens: 20n, cacheWriteTokens: 7n, outputTokens: 9n });
    expect(provider.calls[0]?.headers.get('x-api-key')).toBe('sk-ant-admin');
    expect(provider.calls[0]?.url.searchParams.getAll('group_by[]')).toEqual(['api_key_id', 'model']);

    await connector.revoke('apikey_1');
    expect(provider.calls[1]?.body).toEqual({ status: 'inactive' });
  });
});

describe('Google connector', () => {
  it('uses a plain Gemini API key for visibility-free gateway access', async () => {
    const provider = fakeProvider({ 'GET /v1beta/models': json({ models: [{ name: 'models/gemini-2.5-flash' }] }) });
    const connector = connectorFor('google', { secret: 'fake-gemini-key-123456', config: {}, fetch: provider.fetch });
    expect(connector.capabilities.tier).toBe('T3');
    expect((await connector.test()).fingerprint).toBe('gemini-key:123456');
    expect(provider.calls[0]?.headers.get('x-goog-api-key')).toBe('fake-gemini-key-123456');
    await expect(connector.revoke('projects/p/locations/global/keys/k')).rejects.toBeInstanceOf(ConnectorError);
  });

  it('signs a service-account JWT, lists keys and deletes only API key resources', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const account = {
      type: 'service_account',
      project_id: 'acme-prod',
      client_email: 'aperture@acme-prod.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    };
    const provider = fakeProvider({
      'POST /token': json({ access_token: 'ya29.token', expires_in: 3600 }),
      'GET /v2/projects/acme-prod/locations/global/keys': json({
        keys: [{ name: 'projects/123/locations/global/keys/k1', displayName: 'marketing' }],
      }),
      'DELETE /v2/projects/123/locations/global/keys/k1': json({}),
    });
    const connector = connectorFor('google', { secret: JSON.stringify(account), config: {}, fetch: provider.fetch });
    expect(connector.capabilities.tier).toBe('T2');
    const keys = await connector.listKeys();
    expect(keys).toEqual([
      { externalId: 'projects/123/locations/global/keys/k1', name: 'marketing', hint: null, disabled: false },
    ]);
    const assertion = new URLSearchParams(String(provider.calls[0]?.body)).get('assertion') ?? '';
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1] ?? '', 'base64url').toString()) as { iss: string };
    expect(claims.iss).toBe(account.client_email);
    expect(provider.calls[1]?.headers.get('authorization')).toBe('Bearer ya29.token');

    await connector.revoke('projects/123/locations/global/keys/k1');
    await expect(connector.revoke('https://evil.example/x')).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('price catalog', () => {
  it('converts per-token prices exactly, derives direct-provider entries, and skips variable pricing', async () => {
    const provider = fakeProvider({
      'GET /api/v1/models': json({
        data: [
          {
            id: 'openai/gpt-4o-mini',
            pricing: { prompt: '0.00000015', completion: '0.0000006', input_cache_read: '0.000000075' },
          },
          { id: 'anthropic/claude-sonnet-4.5', pricing: { prompt: '0.000003', completion: '0.000015' } },
          { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
        ],
      }),
    });
    const prices = await fetchPriceCatalog({ fetch: provider.fetch });
    expect(prices.map((p) => `${p.provider}:${p.model}:${String(p.inputPerMTok)}:${String(p.outputPerMTok)}`)).toEqual([
      'openrouter:openai/gpt-4o-mini:150000:600000',
      'openai:gpt-4o-mini:150000:600000',
      'openrouter:anthropic/claude-sonnet-4.5:3000000:15000000',
      'anthropic:claude-sonnet-4-5:3000000:15000000',
    ]);
    expect(prices[0]?.cacheReadPerMTok).toBe(75_000n);
  });

  it('normalises provider model ids to one spelling', () => {
    const cases: [Provider, string, string][] = [
      ['anthropic', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5'],
      ['anthropic', 'claude-sonnet-4.5', 'claude-sonnet-4-5'],
      ['openai', 'gpt-4o-mini-2024-07-18', 'gpt-4o-mini'],
      ['google', 'models/gemini-2.5-flash', 'gemini-2.5-flash'],
      ['openrouter', 'OpenAI/GPT-4o-mini', 'openai/gpt-4o-mini'],
    ];
    for (const [provider, input, expected] of cases) expect(normalizeModel(provider, input)).toBe(expected);
  });

  it('rounds sub-µUSD fractions up, never down', () => {
    expect(decimalToScaled('0.0000000000001', 12)).toBe(1n);
    expect(decimalToScaled('1.5', 12)).toBe(1_500_000_000_000n);
    expect(decimalToScaled('-1', 12)).toBeNull();
    expect(decimalToScaled('abc', 12)).toBeNull();
  });
});

describe('parsers under fuzzing', () => {
  const providers: Provider[] = ['openrouter', 'openai', 'anthropic'];

  it('turn any provider response into data or a typed ConnectorError — never a crash or negative spend', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...providers), fc.jsonValue(), async (provider, body) => {
        const fake = fakeProvider({
          'GET /api/v1/keys': json(body),
          'GET /v1/organization/usage/completions': json(body),
          'GET /v1/organizations/usage_report/messages': json(body),
        });
        const connector = connectorFor(provider, {
          secret: 's',
          config: { projectId: 'p' },
          fetch: fake.fetch,
          sleep: noSleep,
        });
        try {
          if (provider === 'openrouter') {
            for (const key of await connector.listKeys()) expect(key.usage ?? 0n).toBeGreaterThanOrEqual(0n);
          } else {
            for (const record of (await connector.usageSince?.(new Date(0))) ?? []) {
              expect(record.inputTokens + record.outputTokens + record.cacheReadTokens).toBeGreaterThanOrEqual(0n);
            }
          }
        } catch (error) {
          expect(error).toBeInstanceOf(ConnectorError);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('dollar conversion rejects anything that is not a finite, non-negative number', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        try {
          expect(dollarsToMicros(value, 'x')).toBeGreaterThanOrEqual(0n);
        } catch (error) {
          expect(error).toBeInstanceOf(ConnectorError);
        }
      }),
    );
  });
});
