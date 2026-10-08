import { json } from '@aperture/connectors/testing';
import { verifyJws } from '@aperture/crypto';
import { decideApproval, eq, issueMandate, orgJwks, revokeMandate, schema, withSystem } from '@aperture/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createGatewayHarness,
  gateway,
  ledgerOf,
  requestsOf,
  ring,
  seedGatewayOrg,
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
const completion = {
  id: 'gen-1',
  choices: [{ message: { role: 'assistant', content: 'hello' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
};
const upstreamRoutes = { 'POST /api/v1/chat/completions': json(completion) };

async function newUser(name: string) {
  const id = crypto.randomUUID();
  await h.system.db.insert(schema.users).values({ id, name, email: `${id}@example.com`, emailVerified: true });
  return id;
}

async function policy(orgId: string, document: unknown) {
  await h.system.db.insert(schema.policies).values({
    id: crypto.randomUUID(),
    orgId,
    scope: 'org',
    scopeId: orgId,
    version: 1,
    document,
    createdBy: await newUser('Policy author'),
  });
}

const hour = () => ({
  notBefore: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});

async function get(app: ReturnType<typeof gateway>['app'], path: string, key: string) {
  return app.request(path, { headers: { authorization: `Bearer ${key}` } });
}

describe('approvals in the gateway', () => {
  it('opens one approval, and a retry with the approved id goes through exactly once', async () => {
    const org = await seedGatewayOrg(h);
    await policy(org.org.id, { rules: [{ id: 'ask', type: 'approval_threshold', above: '0.00001' }] });
    const { call, upstream } = gateway(h, upstreamRoutes);

    const first = await call('/v1/chat/completions', org.key, chat);
    expect(first.status).toBe(403);
    const body = (await first.json()) as { error: { type: string; approval_id: string } };
    expect(body.error.type).toBe('aperture_approval_required');
    const again = (await (await call('/v1/chat/completions', org.key, chat)).json()) as typeof body;
    expect(again.error.approval_id).toBe(body.error.approval_id);
    expect(upstream.calls).toHaveLength(0);
    expect((await requestsOf(h, org.org.id)).map((row) => row.outcome)).toEqual([
      'approval_required',
      'approval_required',
    ]);

    // Still pending: the header alone doesn't help.
    const early = await call('/v1/chat/completions', org.key, chat, { 'x-aperture-approval': body.error.approval_id });
    expect(early.status).toBe(403);

    await decideApproval(h.system.db, ring, {
      orgId: org.org.id,
      approvalId: body.error.approval_id,
      deciderUserId: await newUser('Approver'),
      approve: true,
    });
    const approved = await call('/v1/chat/completions', org.key, chat, {
      'x-aperture-approval': body.error.approval_id,
    });
    expect(approved.status).toBe(200);
    expect(upstream.calls).toHaveLength(1);
    const [row] = await h.system.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, body.error.approval_id));
    expect(row?.status).toBe('used');

    const replay = await call('/v1/chat/completions', org.key, chat, { 'x-aperture-approval': body.error.approval_id });
    expect(replay.status).toBe(403);
    expect(upstream.calls).toHaveLength(1);
  });

  it('an approval for one model does not unlock another', async () => {
    const org = await seedGatewayOrg(h);
    await policy(org.org.id, { rules: [{ id: 'ask', type: 'approval_threshold', above: '0.00001' }] });
    const { call, app } = gateway(h, upstreamRoutes);
    const created = await app.request('/v1/approvals', {
      method: 'POST',
      headers: { authorization: `Bearer ${org.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter',
        model: 'openai/gpt-4o',
        amount_usd: '1',
        purpose: 'bigger model',
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await decideApproval(h.system.db, ring, {
      orgId: org.org.id,
      approvalId: id,
      deciderUserId: await newUser('Approver'),
      approve: true,
    });
    expect(await (await get(app, `/v1/approvals/${id}`, org.key)).json()).toMatchObject({
      status: 'approved',
      approved_usd: '1.00',
    });
    expect((await call('/v1/chat/completions', org.key, chat, { 'x-aperture-approval': id })).status).toBe(403);
  });
});

describe('mandates in the gateway', () => {
  it('a standing mandate narrows models and is counted per use; revoking it stops the agent', async () => {
    const org = await seedGatewayOrg(h);
    const mandate = await issueMandate(h.system.db, ring, {
      orgId: org.org.id,
      subjectPrincipalId: org.agent.id,
      issuerUserId: await newUser('Admin'),
      scope: {
        rails: ['gateway'],
        models: ['openai/*'],
        budget: { limit: '0.5', period: 'none' },
        maxUses: 2,
        purpose: 'research',
        ...hour(),
      },
    });
    const { call, upstream, app } = gateway(h, upstreamRoutes);
    expect(
      (await call('/v1/chat/completions', org.key, { ...chat, model: 'anthropic/claude-sonnet-4-5' })).status,
    ).toBe(403);
    expect((await call('/v1/chat/completions', org.key, chat)).status).toBe(200);

    const me = (await (await get(app, '/v1/me', org.key)).json()) as {
      mandate: { id: string; uses: number; jws: string };
    };
    expect(me.mandate).toMatchObject({ id: mandate.id, uses: 1 });
    const jwks = await withSystem(h.system.db, (tx) => orgJwks(tx, org.org.id));
    expect(verifyJws(me.mandate.jws, jwks).payload).toMatchObject({ jti: mandate.id });

    // The mandate's budget node took the hold alongside the principal's budget.
    const [usage] = await h.system.db
      .select()
      .from(schema.budgetUsage)
      .where(eq(schema.budgetUsage.budgetId, mandate.budgetId ?? ''));
    expect((usage?.spent ?? 0n) + (usage?.held ?? 0n)).toBeGreaterThan(0n);
    expect((await ledgerOf(h, org.org.id)).length).toBeGreaterThan(0);

    expect((await call('/v1/chat/completions', org.key, chat)).status).toBe(200);
    const exhausted = await call('/v1/chat/completions', org.key, chat);
    expect(exhausted.status).toBe(403);
    expect(upstream.calls).toHaveLength(2);

    await withSystem(h.system.db, (tx) => revokeMandate(tx, { orgId: org.org.id, mandateId: mandate.id }));
    expect((await call('/v1/chat/completions', org.key, chat)).status).toBe(403);
  });

  it('lists only the models the mandate allows', async () => {
    const org = await seedGatewayOrg(h);
    await issueMandate(h.system.db, ring, {
      orgId: org.org.id,
      subjectPrincipalId: org.agent.id,
      scope: {
        rails: ['gateway'],
        providers: ['anthropic'],
        budget: { limit: '1', period: 'day' },
        purpose: 'claude only',
        ...hour(),
      },
    });
    const { app } = gateway(h, {});
    const models = (await (await get(app, '/v1/models', org.key)).json()) as { data: { id: string }[] };
    expect(models.data.map((model) => model.id)).toEqual(['claude-sonnet-4-5']);
  });
});

describe('sub-agents', () => {
  it('delegates a narrower mandate with its own key; the parent’s revocation cascades', async () => {
    const org = await seedGatewayOrg(h);
    const root = await issueMandate(h.system.db, ring, {
      orgId: org.org.id,
      subjectPrincipalId: org.agent.id,
      scope: { rails: ['gateway'], budget: { limit: '1', period: 'none' }, purpose: 'orchestrator', ...hour() },
    });
    const { app, call } = gateway(h, upstreamRoutes);
    const create = (body: unknown) =>
      app.request('/v1/subagents', {
        method: 'POST',
        headers: { authorization: `Bearer ${org.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const tooBig = await create({ name: 'greedy', purpose: 'x', budget_usd: '5' });
    expect(tooBig.status).toBe(403);

    const response = await create({
      name: 'summariser',
      purpose: 'summaries',
      budget_usd: '0.2',
      models: ['openai/*'],
    });
    expect(response.status).toBe(201);
    const child = (await response.json()) as {
      principal_id: string;
      api_key: string;
      mandate: { id: string; parent_id: string };
    };
    expect(child.mandate.parent_id).toBe(root.id);

    expect((await call('/v1/chat/completions', child.api_key, chat)).status).toBe(200);
    expect(
      (await call('/v1/chat/completions', child.api_key, { ...chat, model: 'anthropic/claude-sonnet-4-5' })).status,
    ).toBe(403);

    await withSystem(h.system.db, (tx) => revokeMandate(tx, { orgId: org.org.id, mandateId: root.id }));
    expect((await call('/v1/chat/completions', child.api_key, chat)).status).toBe(401);
    const [principal] = await h.system.db
      .select()
      .from(schema.principals)
      .where(eq(schema.principals.id, child.principal_id));
    expect(principal?.status).toBe('revoked');
  });

  it('refuses to delegate without a mandate, and an agent can pause itself', async () => {
    const org = await seedGatewayOrg(h);
    const { app, call } = gateway(h, upstreamRoutes);
    const denied = await app.request('/v1/subagents', {
      method: 'POST',
      headers: { authorization: `Bearer ${org.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', purpose: 'x', budget_usd: '0.1' }),
    });
    expect(denied.status).toBe(403);
    const pause = await app.request('/v1/me/pause', {
      method: 'POST',
      headers: { authorization: `Bearer ${org.key}` },
    });
    expect(pause.status).toBe(200);
    expect((await call('/v1/chat/completions', org.key, chat)).status).toBe(403);
  });
});

describe('MCP over HTTP', () => {
  it('serves the tools at /mcp with the caller’s own authority', async () => {
    const org = await seedGatewayOrg(h);
    const { app } = gateway(h, {});
    const rpc = (body: unknown) =>
      app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${org.key}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      });
    const result = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_budget', arguments: {} },
    });
    const payload = (await result.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(payload.result.content[0]?.text ?? '{}')).toMatchObject({
      principal: { id: org.agent.id, name: 'research-bot' },
    });
  });
});

describe('task cards (Phase 8)', () => {
  it('an agent asks for a single-use card; it waits for a person and never includes a number', async () => {
    const org = await seedGatewayOrg(h);
    const { app } = gateway(h, {});
    const asked = await app.request('/v1/cards/task', {
      method: 'POST',
      headers: { authorization: `Bearer ${org.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount_usd: '49.00', category: 'computer_software_stores', purpose: 'annual licence' }),
    });
    expect(asked.status).toBe(202);
    const approval = (await asked.json()) as { id: string; status: string; rail: string; card: unknown };
    expect(approval).toMatchObject({ status: 'pending', rail: 'card', card: null });
    const bad = await app.request('/v1/cards/task', {
      method: 'POST',
      headers: { authorization: `Bearer ${org.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount_usd: '1', category: 'DROP TABLE', purpose: 'x' }),
    });
    expect(bad.status).toBe(400);
    const polled = await get(app, `/v1/approvals/${approval.id}`, org.key);
    expect(await polled.json()).toMatchObject({ status: 'pending', card: null });
  });
});

describe('agent card (Phase 11)', () => {
  it('shows the agent its declared purpose, rules and budget, and never a key or secret', async () => {
    const org = await seedGatewayOrg(h);
    await h.system.db
      .update(schema.principals)
      .set({ purpose: 'Summarise support tickets', dataClasses: ['internal'], riskTier: 'medium' })
      .where(eq(schema.principals.id, org.agent.id));
    await policy(org.org.id, { rules: [{ id: 'cap', type: 'max_amount_per_action', max: '1.00' }] });
    const { app } = gateway(h, {});

    const response = await get(app, '/v1/card', org.key);
    expect(response.status).toBe(200);
    const card = (await response.json()) as Record<string, unknown>;
    expect(card).toMatchObject({
      id: org.agent.id,
      name: 'research-bot',
      status: 'active',
      purpose: 'Summarise support tickets',
      data_classes: ['internal'],
      risk_tier: 'medium',
      live_keys: 1,
    });
    expect(card.rules).toContainEqual({ level: 'org', type: 'max_amount_per_action' });
    expect(JSON.stringify(card)).not.toContain(org.key);
    expect(Object.keys(card)).not.toEqual(expect.arrayContaining(['secret', 'hash', 'key']));

    expect((await get(app, '/v1/card', 'apk_not_a_key')).status).toBe(401);
  });
});
