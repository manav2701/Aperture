import { createHmac } from 'node:crypto';
import { json } from '@aperture/connectors/testing';
import { eq, schema, upsertPrices, withSystem } from '@aperture/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifySlackSignature } from '../src/slack';
import { SLACK_SIGNING_SECRET, body, createHarness, createOrg, joinAs, signUp, type Harness } from './harness';

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
const email = (label: string) => `${label}-slack-${String((counter += 1))}@example.com`;
const post = (path: string, cookie: string, payload: unknown = {}) =>
  h.request(path, { method: 'POST', cookie, body: JSON.stringify(payload) });

function sign(raw: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = `v0=${createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(`v0:${String(timestamp)}:${raw}`)
    .digest('hex')}`;
  return { 'x-slack-request-timestamp': String(timestamp), 'x-slack-signature': signature };
}

function interaction(input: { team: string; user: string; action: 'approve' | 'deny'; approvalId: string }) {
  const payload = {
    type: 'block_actions',
    team: { id: input.team },
    user: { id: input.user },
    actions: [{ action_id: input.action, value: input.approvalId }],
    response_url: 'https://hooks.slack.com/actions/T1/1/abc',
  };
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}

describe('Slack signatures', () => {
  it('accepts only Slack’s exact signature within five minutes', () => {
    const raw = 'payload=%7B%7D';
    const now = Date.now();
    const headers = sign(raw, Math.floor(now / 1000));
    const check = (h2: Record<string, string>, body2 = raw, at = now) =>
      verifySlackSignature(
        SLACK_SIGNING_SECRET,
        { timestamp: h2['x-slack-request-timestamp'] ?? null, signature: h2['x-slack-signature'] ?? null },
        body2,
        at,
      );
    expect(check(headers)).toBe(true);
    expect(check(headers, `${raw}x`)).toBe(false);
    expect(check(headers, raw, now + 6 * 60_000)).toBe(false);
    expect(check({ ...headers, 'x-slack-signature': 'v0=00' })).toBe(false);
  });
});

describe('Slack app (Phase 7)', () => {
  it('installs per org, and Approve in Slack decides as the matching verified member (with SoD)', async () => {
    const ownerEmail = email('owner');
    const owner = await signUp(h, ownerEmail);
    const orgId = await createOrg(h, owner);
    const base = `/api/v1/orgs/${orgId}`;
    await post(`${base}/budgets`, owner, { name: 'Company', scope: 'org', period: 'month', limit: '100' });
    const financeEmail = email('finance');
    await joinAs(h, { ownerCookie: owner, orgId, email: financeEmail, role: 'finance' });

    const replies: unknown[] = [];
    const slackUsers: Record<string, string> = { UFIN: financeEmail, UOWN: ownerEmail };
    h.provider({
      'GET /api/v1/key': json({ data: { is_management_key: true, organization_id: 'or-org-1' } }),
      'GET /api/v1/keys': json({ data: [] }),
      'POST /api/v1/keys': (call) =>
        Response.json({
          data: { hash: 'gw', name: 'gw', label: 'sk-or-v1-a...z', disabled: false, usage: 0, limit: null },
          key: `sk-or-v1-${(call.body as { name: string }).name}`,
        }),
      'POST /api/oauth.v2.access': (call) => {
        expect(String(call.body)).toContain('code=slack-code');
        return Response.json({
          ok: true,
          access_token: 'xoxb-test-token',
          team: { id: 'T1', name: 'Acme' },
          incoming_webhook: { channel: '#approvals', channel_id: 'C1' },
        });
      },
      'POST /api/users.info': (call) => {
        const user = (call.body as { user: string }).user;
        const address = slackUsers[user];
        return Response.json(
          address === undefined
            ? { ok: false, error: 'user_not_found' }
            : { ok: true, user: { is_email_confirmed: true, profile: { email: address } } },
        );
      },
      'POST /actions/T1/1/abc': (call) => {
        replies.push(call.body);
        return new Response('ok');
      },
    });

    // Install: the dashboard gets Slack's URL; Slack sends the browser back with a code.
    const { url } = await body<{ url: string }>(await h.request(`${base}/slack/install`, { cookie: owner }));
    const state = new URL(url).searchParams.get('state') ?? '';
    expect(new URL(url).searchParams.get('client_id')).toBe('slack-client-id');
    const callback = await h.request(`/api/slack/oauth/callback?code=slack-code&state=${encodeURIComponent(state)}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toContain(`/orgs/${orgId}/settings/alerts`);
    const forged = await h.request(
      `/api/slack/oauth/callback?code=slack-code&state=${encodeURIComponent(`${state}x`)}`,
    );
    expect(forged.status).toBe(400);

    // An approval to decide.
    const connection = await body<{ id: string }>(
      await post(`${base}/connections`, owner, { provider: 'openrouter', secret: 'sk-or-v1-m' }),
    );
    await post(`${base}/connections/${connection.id}/gateway-key`, owner);
    const agent = await body<{ id: string }>(await post(`${base}/agents`, owner, { name: 'writer' }));
    const { key } = await body<{ key: string }>(
      await post(`${base}/principals/${agent.id}/keys`, owner, { name: 'k' }),
    );
    await h.request(`${base}/policies/org/${orgId}`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({ document: { rules: [{ id: 'ask', type: 'approval_threshold', above: '0.00001' }] } }),
    });
    const denied = await h.request('/gw/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 20,
      }),
    });
    const approvalId = (await body<{ error: { approval_id: string } }>(denied)).error.approval_id;

    const click = (raw: string, headers = sign(raw)) =>
      h.request('/api/slack/interactions', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: raw,
      });

    // Unsigned or from another workspace: nothing happens.
    const raw = interaction({ team: 'T1', user: 'UFIN', action: 'approve', approvalId });
    expect((await click(raw, { 'x-slack-request-timestamp': '1', 'x-slack-signature': 'v0=bad' })).status).toBe(401);
    expect((await click(interaction({ team: 'T-other', user: 'UFIN', action: 'approve', approvalId }))).status).toBe(
      200,
    );
    // A Slack user Aperture can't match is refused.
    expect((await click(interaction({ team: 'T1', user: 'USTRANGER', action: 'approve', approvalId }))).status).toBe(
      200,
    );
    const [still] = await h.system.db.select().from(schema.approvals).where(eq(schema.approvals.id, approvalId));
    expect(still?.status).toBe('pending');

    // The agent's owner may not approve its request (separation of duties), from Slack either.
    expect((await click(interaction({ team: 'T1', user: 'UOWN', action: 'approve', approvalId }))).status).toBe(200);
    expect(JSON.stringify(replies.at(-1))).toContain('an agent you own');

    expect((await click(raw)).status).toBe(200);
    const [decided] = await h.system.db.select().from(schema.approvals).where(eq(schema.approvals.id, approvalId));
    expect(decided).toMatchObject({ status: 'approved', decisionNote: 'via Slack' });
    expect(JSON.stringify(replies.at(-1))).toContain('Approved by');
    expect(JSON.stringify(replies)).toContain('not connected to that organization');
  });
});
