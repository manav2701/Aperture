import { json } from '@aperture/connectors/testing';
import { upsertPrices, withSystem } from '@aperture/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, createHarness, createOrg, joinAs, signUp, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await withSystem(h.system.db, (tx) =>
    upsertPrices(tx, [
      {
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
        inputPerMTok: 150_000n,
        outputPerMTok: 600_000n,
        cacheReadPerMTok: null,
        cacheWritePerMTok: null,
        source: 'test',
      },
    ]),
  );
});
afterAll(async () => {
  await h.close();
});

let counter = 0;
const email = (label: string) => `${label}-${String((counter += 1))}@example.com`;
const post = (path: string, cookie: string, payload: unknown = {}) =>
  h.request(path, { method: 'POST', cookie, body: JSON.stringify(payload) });

const orKey = (hash: string, usage = 0, limit: number | null = null) => ({
  hash,
  name: `key ${hash}`,
  label: 'sk-or-v1-ab...yz',
  disabled: false,
  usage,
  limit,
});

/** OpenRouter as the fake provider: management-key check, key list, key creation, chat. */
function fakeOpenRouter() {
  return h.provider({
    'GET /api/v1/key': json({ data: { is_management_key: true, organization_id: 'or-org-1' } }),
    'GET /api/v1/keys': (call) =>
      Response.json({ data: call.url.searchParams.get('offset') === '0' ? [orKey('existing-1', 3.5)] : [] }),
    'POST /api/v1/keys': (call) => {
      const name = (call.body as { name: string }).name;
      return Response.json({
        data: orKey(
          name === 'aperture-gateway' ? 'gw-hash' : 'agent-hash',
          0,
          (call.body as { limit: number | null }).limit,
        ),
        key: `sk-or-v1-${name}`,
      });
    },
    'POST /api/v1/chat/completions': json({
      id: 'gen-1',
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0002 },
    }),
  });
}

async function newOrg() {
  const owner = await signUp(h, email('owner'));
  const orgId = await createOrg(h, owner);
  const base = `/api/v1/orgs/${orgId}`;
  // A company budget so people and agents without their own budget can spend (inheritance).
  await post(`${base}/budgets`, owner, { name: 'Company', scope: 'org', period: 'month', limit: '100' });
  return { owner, orgId, base };
}

describe('connections (Phase 4)', () => {
  it('tests and stores a connection without ever returning the secret, and refuses duplicates', async () => {
    const { owner, orgId, base } = await newOrg();
    fakeOpenRouter();
    const created = await post(`${base}/connections`, owner, {
      provider: 'openrouter',
      secret: 'sk-or-v1-management-secret',
    });
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain('management-secret');
    expect(JSON.parse(text)).toMatchObject({
      provider: 'openrouter',
      tier: 'T1',
      status: 'active',
      keys: 1,
      unassigned: 1,
    });

    expect(
      (await post(`${base}/connections`, owner, { provider: 'openrouter', secret: 'sk-or-v1-management-secret' }))
        .status,
    ).toBe(409);
    const member = await joinAs(h, { ownerCookie: owner, orgId, email: email('member'), role: 'member' });
    expect((await post(`${base}/connections`, member, { provider: 'openrouter', secret: 'sk-or-v1-x' })).status).toBe(
      403,
    );
    expect((await h.request(`${base}/connections`, { cookie: member })).status).toBe(403);
  });

  it('reports a bad provider key as a 502 with the provider’s reason, storing nothing', async () => {
    const { owner, base } = await newOrg();
    h.provider({ 'GET /api/v1/key': json({ error: 'invalid key' }, 401) });
    const response = await post(`${base}/connections`, owner, { provider: 'openrouter', secret: 'sk-or-v1-wrong' });
    expect(response.status).toBe(502);
    expect(await body<{ error: { code: string } }>(response)).toMatchObject({
      error: { code: 'provider_unauthorized' },
    });
    expect(
      (await body<{ connections: unknown[] }>(await h.request(`${base}/connections`, { cookie: owner }))).connections,
    ).toEqual([]);
  });

  it('assigns imported keys and creates budget-capped keys for agents (shown once)', async () => {
    const { owner, base } = await newOrg();
    const calls = fakeOpenRouter();
    const connection = await body<{ id: string }>(
      await post(`${base}/connections`, owner, { provider: 'openrouter', secret: 'sk-or-v1-m' }),
    );
    const agent = await body<{ id: string }>(
      await post(`${base}/agents`, owner, { name: 'research-bot', budget: { limit: '2.50', period: 'day' } }),
    );

    const { credentials } = await body<{ credentials: { id: string; principal: unknown }[] }>(
      await h.request(`${base}/credentials`, { cookie: owner }),
    );
    expect(credentials[0]?.principal).toBeNull();
    const assign = await h.request(`${base}/credentials/${credentials[0]?.id ?? ''}`, {
      method: 'PATCH',
      cookie: owner,
      body: JSON.stringify({ principalId: agent.id }),
    });
    expect(assign.status).toBe(204);

    const created = await post(`${base}/connections/${connection.id}/credentials`, owner, { principalId: agent.id });
    expect(created.status).toBe(201);
    const result = await body<{ secret: string; credential: { limit: string } }>(created);
    expect(result.secret).toBe('sk-or-v1-aperture:research-bot');
    expect(result.credential.limit).toBe('2.50');
    expect(
      calls.find((c) => c.method === 'POST' && (c.body as { name: string }).name === 'aperture:research-bot')?.body,
    ).toMatchObject({ limit: 2.5, limit_reset: null });
    expect(await (await h.request(`${base}/credentials`, { cookie: owner })).text()).not.toContain('sk-or-v1-aperture');
  });
});

describe('gateway through the API process (Phase 5)', () => {
  it('runs agent traffic through /gw, records spend, and honours the kill switch', async () => {
    const { owner, base } = await newOrg();
    const calls = fakeOpenRouter();
    const connection = await body<{ id: string }>(
      await post(`${base}/connections`, owner, { provider: 'openrouter', secret: 'sk-or-v1-m' }),
    );
    expect((await post(`${base}/connections/${connection.id}/gateway-key`, owner)).status).toBe(201);

    const agent = await body<{ id: string }>(
      await post(`${base}/agents`, owner, { name: 'writer', budget: { limit: '1', period: 'day' } }),
    );
    const issued = await body<{ key: string; apiKey: { prefix: string } }>(
      await post(`${base}/principals/${agent.id}/keys`, owner, { name: 'prod' }),
    );
    expect(issued.key.startsWith(issued.apiKey.prefix)).toBe(true);
    const listed = await h.request(`${base}/keys`, { cookie: owner });
    expect(await listed.text()).not.toContain(issued.key);

    const chat = () =>
      h.request('/gw/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.key}` },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 50,
        }),
      });
    const ok = await chat();
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-aperture-cost-usd')).toBe('0.0002');
    expect(calls.find((c) => c.url.pathname === '/api/v1/chat/completions')?.headers.get('authorization')).toBe(
      'Bearer sk-or-v1-aperture-gateway',
    );

    const spend = await body<{ total: string; groups: { label: string; amount: string }[] }>(
      await h.request(`${base}/spend?groupBy=principal`, { cookie: owner }),
    );
    expect(spend.total).toBe('0.0002');
    expect(spend.groups).toEqual([{ key: agent.id, label: 'writer', amount: '0.0002' }]);
    const requests = await body<{ requests: { outcome: string }[] }>(
      await h.request(`${base}/gateway/requests`, { cookie: owner }),
    );
    expect(requests.requests[0]?.outcome).toBe('allowed');

    expect((await post(`${base}/principals/${agent.id}/status`, owner, { status: 'paused' })).status).toBe(204);
    expect((await chat()).status).toBe(403);
    expect((await post(`${base}/principals/${agent.id}/status`, owner, { status: 'active' })).status).toBe(204);
    expect((await chat()).status).toBe(200);
    expect((await post(`${base}/principals/${agent.id}/status`, owner, { status: 'revoked' })).status).toBe(204);
    expect((await chat()).status).toBe(401);
  });

  it('streams the workspace chat as the signed-in person without exposing a key', async () => {
    const { owner, base } = await newOrg();
    h.provider({
      'GET /api/v1/key': json({ data: { is_management_key: true, organization_id: 'or-org-2' } }),
      'GET /api/v1/keys': json({ data: [] }),
      'POST /api/v1/keys': json({ data: orKey('gw'), key: 'sk-or-v1-gw' }),
      'POST /api/v1/chat/completions': () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.00001 } })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    const connection = await body<{ id: string }>(
      await post(`${base}/connections`, owner, { provider: 'openrouter', secret: 'sk-or-v1-m' }),
    );
    await post(`${base}/connections/${connection.id}/gateway-key`, owner);

    const workspace = await body<{ available: boolean; remaining: string }>(
      await h.request(`${base}/workspace`, { cookie: owner }),
    );
    expect(workspace).toMatchObject({ available: true, remaining: '100.00' });
    const response = await post(`${base}/workspace/chat`, owner, {
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toContain('Hello');
  });

  it('lets team leads manage only their own team’s agents', async () => {
    const { owner, orgId, base } = await newOrg();
    const team = await body<{ id: string }>(await post(`${base}/teams`, owner, { name: 'Research' }));
    const lead = await joinAs(h, {
      ownerCookie: owner,
      orgId,
      email: email('lead'),
      role: 'team_lead',
      teamId: team.id,
    });
    expect((await post(`${base}/agents`, lead, { name: 'mine', teamId: team.id })).status).toBe(201);
    expect((await post(`${base}/agents`, lead, { name: 'not-mine' })).status).toBe(403);
    expect((await post(`${base}/agents/pause-all`, lead)).status).toBe(403);
  });
});
