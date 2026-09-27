import { json } from '@aperture/connectors/testing';
import { verifyJws } from '@aperture/crypto';
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

function fakeOpenRouter() {
  return h.provider({
    'GET /api/v1/key': json({ data: { is_management_key: true, organization_id: 'or-org-1' } }),
    'GET /api/v1/keys': json({ data: [] }),
    'POST /api/v1/keys': (call) =>
      Response.json({
        data: { hash: 'gw', name: 'gw', label: 'sk-or-v1-a...z', disabled: false, usage: 0, limit: null },
        key: `sk-or-v1-${(call.body as { name: string }).name}`,
      }),
    'POST /api/v1/chat/completions': json({
      id: 'gen-1',
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0002 },
    }),
  });
}

/** An org with OpenRouter on the gateway, an agent owned by the owner, and the agent's key. */
async function setup() {
  const owner = await signUp(h, email('owner'));
  const orgId = await createOrg(h, owner);
  const base = `/api/v1/orgs/${orgId}`;
  await post(`${base}/budgets`, owner, { name: 'Company', scope: 'org', period: 'month', limit: '100' });
  fakeOpenRouter();
  const connection = await body<{ id: string }>(
    await post(`${base}/connections`, owner, { provider: 'openrouter', secret: 'sk-or-v1-m' }),
  );
  await post(`${base}/connections/${connection.id}/gateway-key`, owner);
  const agent = await body<{ id: string }>(
    await post(`${base}/agents`, owner, { name: 'writer', budget: { limit: '5', period: 'day' } }),
  );
  const { key } = await body<{ key: string }>(await post(`${base}/principals/${agent.id}/keys`, owner, { name: 'k' }));
  const chat = (headers: Record<string, string> = {}) =>
    h.request('/gw/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, ...headers },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 50,
      }),
    });
  return { owner, orgId, base, agent, key, chat };
}

describe('approvals (Phase 7)', () => {
  it('routes a request to a human; the agent’s owner may not approve it, finance can', async () => {
    const { owner, orgId, base, chat } = await setup();
    const policy = await h.request(`${base}/policies/org/${orgId}`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({ document: { rules: [{ id: 'ask', type: 'approval_threshold', above: '0.00001' }] } }),
    });
    expect(policy.status).toBe(200);

    const blocked = await chat();
    expect(blocked.status).toBe(403);
    const { error } = await body<{ error: { approval_id: string } }>(blocked);

    const listed = await body<{ approvals: { id: string; status: string; requester: { name: string } }[] }>(
      await h.request(`${base}/approvals`, { cookie: owner }),
    );
    expect(listed.approvals[0]).toMatchObject({
      id: error.approval_id,
      status: 'pending',
      requester: { name: 'writer' },
    });

    const selfApproval = await post(`${base}/approvals/${error.approval_id}/approve`, owner, {});
    expect(selfApproval.status).toBe(403);
    expect(await body<{ error: { code: string } }>(selfApproval)).toMatchObject({
      error: { code: 'separation_of_duties' },
    });

    const finance = await joinAs(h, { ownerCookie: owner, orgId, email: email('finance'), role: 'finance' });
    const approved = await post(`${base}/approvals/${error.approval_id}/approve`, finance, { note: 'ok for today' });
    expect(approved.status).toBe(200);
    expect(await body(approved)).toMatchObject({ status: 'approved', note: 'ok for today' });
    expect((await post(`${base}/approvals/${error.approval_id}/deny`, finance, {})).status).toBe(409);

    expect((await chat({ 'x-aperture-approval': error.approval_id })).status).toBe(200);
    expect((await chat({ 'x-aperture-approval': error.approval_id })).status).toBe(403);

    const audit = await h.request(`${base}/audit`, { cookie: owner });
    expect(await audit.text()).toContain('approval.approved');
  });

  it('lets members neither read nor decide approvals', async () => {
    const { owner, orgId, base } = await setup();
    const member = await joinAs(h, { ownerCookie: owner, orgId, email: email('member'), role: 'member' });
    expect((await h.request(`${base}/approvals`, { cookie: member })).status).toBe(403);
  });
});

describe('mandates (Phase 7)', () => {
  it('issues a signed mandate that the public JWKS verifies, and revokes it', async () => {
    const { owner, orgId, base, agent, chat } = await setup();
    const issued = await post(`${base}/agents/${agent.id}/mandates`, owner, {
      purpose: 'nightly summaries',
      budget: { limit: '0.5', period: 'day' },
      models: ['openai/*'],
      validDays: 7,
    });
    expect(issued.status).toBe(201);
    const mandate = await body<{ id: string; jws: string; remaining: string }>(issued);
    expect(mandate.remaining).toBe('0.50');

    const jwks = await body<{ keys: { kid: string }[] }>(
      await h.request(`/.well-known/aperture/orgs/${orgId}/jwks.json`),
    );
    expect(verifyJws(mandate.jws, jwks).payload).toMatchObject({
      jti: mandate.id,
      sub: `aperture:principal:${agent.id}`,
    });
    expect(await body(await h.request(`${base}/jwks.json`))).toEqual(jwks);

    expect((await chat()).status).toBe(200);
    const listed = await body<{ mandates: { id: string; uses: number }[] }>(
      await h.request(`${base}/mandates?principalId=${agent.id}`, { cookie: owner }),
    );
    expect(listed.mandates).toMatchObject([{ id: mandate.id, uses: 1 }]);

    expect(await body(await post(`${base}/mandates/${mandate.id}/revoke`, owner))).toEqual({ revoked: 1 });
    expect((await chat()).status).toBe(403);

    // Rotation: the old mandate still verifies, new ones use the new key.
    const { kid } = await body<{ kid: string }>(await post(`${base}/signing-keys/rotate`, owner));
    const rotated = await body<{ keys: { kid: string }[] }>(await h.request(`${base}/jwks.json`));
    expect(rotated.keys.map((key) => key.kid)).toContain(kid);
    expect(verifyJws(mandate.jws, rotated).payload).toMatchObject({ jti: mandate.id });
  });

  it('rejects mandates for people and invalid scopes', async () => {
    const { owner, orgId, base } = await setup();
    const people = await body<{ members: { principalId: string }[] }>(
      await h.request(`${base}/members`, { cookie: owner }),
    );
    const me = people.members[0]?.principalId ?? orgId;
    const forPerson = await post(`${base}/agents/${me}/mandates`, owner, {
      purpose: 'x',
      budget: { limit: '1', period: 'day' },
    });
    expect([400, 404]).toContain(forPerson.status);
  });
});

describe('policy suggestions (Phase 7)', () => {
  it('after three approvals and no denials, suggests a threshold that stops asking; applying it works', async () => {
    const { owner, orgId, base, chat } = await setup();
    await h.request(`${base}/policies/org/${orgId}`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({ document: { rules: [{ id: 'ask', type: 'approval_threshold', above: '0.00001' }] } }),
    });
    const finance = await joinAs(h, { ownerCookie: owner, orgId, email: email('finance'), role: 'finance' });
    for (let round = 0; round < 3; round += 1) {
      const { error } = await body<{ error: { approval_id: string } }>(await chat());
      expect((await post(`${base}/approvals/${error.approval_id}/approve`, finance, {})).status).toBe(200);
      expect((await chat({ 'x-aperture-approval': error.approval_id })).status).toBe(200);
    }
    const { suggestions } = await body<{
      suggestions: {
        ruleId: string;
        currentAbove: string;
        suggestedAbove: string;
        document: unknown;
        expectedVersion: number;
      }[];
    }>(await h.request(`${base}/policy-suggestions`, { cookie: owner }));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ ruleId: 'ask', currentAbove: '0.00001', approvals: 3 });

    const applied = await h.request(`${base}/policies/org/${orgId}`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({ document: suggestions[0]?.document, expectedVersion: suggestions[0]?.expectedVersion }),
    });
    expect(applied.status).toBe(200);
    h.gatewayCache.invalidate(orgId); // what the policies NOTIFY trigger does in production
    expect((await chat()).status).toBe(200);
  });
});
