import { createHmac } from 'node:crypto';
import { verifyJws } from '@aperture/crypto';
import { count, eq, schema } from '@aperture/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, createHarness, createOrg, joinAs, signUp, type Harness } from './harness';

/*
 * Phases 11 and 12 through the API: posture and waivers, inventory and CSV, statement imports,
 * signed attestations and share links, agent cards, seats and tools, telemetry through the
 * gateway, and the receipts inbox.
 */

const INBOUND_SECRET = 'inbound-test-secret-that-is-at-least-32-chars';
let h: Harness;
beforeAll(async () => {
  h = await createHarness({
    inboundEmail: { domain: 'in.aperture.test', secret: INBOUND_SECRET, authservId: 'mx.aperture.test' },
  });
});
afterAll(async () => {
  await h.close();
});

let counter = 0;
const email = (label: string) => `${label}-${String((counter += 1))}@acme.example`;
const post = (path: string, cookie: string, payload: unknown = {}) =>
  h.request(path, { method: 'POST', cookie, body: JSON.stringify(payload) });
const put = (path: string, cookie: string, payload: unknown) =>
  h.request(path, { method: 'PUT', cookie, body: JSON.stringify(payload) });
const patch = (path: string, cookie: string, payload: unknown) =>
  h.request(path, { method: 'PATCH', cookie, body: JSON.stringify(payload) });
const get = (path: string, cookie: string) => h.request(path, { cookie });

async function org() {
  const ownerEmail = email('owner');
  const owner = await signUp(h, ownerEmail);
  const orgId = await createOrg(h, owner);
  return { owner, ownerEmail, orgId, base: `/api/v1/orgs/${orgId}` };
}

const ledgerRows = async (orgId: string) =>
  (await h.system.db.select({ n: count() }).from(schema.ledgerEntries).where(eq(schema.ledgerEntries.orgId, orgId)))[0]
    ?.n;

function receiptEml(from: string, subject: string, text: string) {
  return [
    `From: ${from}`,
    'To: receipts-x@in.aperture.test',
    `Subject: ${subject}`,
    'Date: Mon, 05 Oct 2026 09:12:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\r\n');
}

describe('posture', () => {
  it('runs on demand, limits manual runs, and records waivers in the audit log', async () => {
    const { owner, base } = await org();
    expect((await body<{ run: unknown }>(await get(`${base}/posture`, owner))).run).toBeNull();
    const run = await post(`${base}/posture/runs`, owner);
    expect(run.status).toBe(201);
    expect((await post(`${base}/posture/runs`, owner)).status).toBe(429);

    const posture = await body<{ results: { id: string; status: string }[]; catalogue: unknown[] }>(
      await get(`${base}/posture`, owner),
    );
    expect(posture.catalogue.length).toBeGreaterThanOrEqual(37);
    expect(posture.results.find((r) => r.id === 'spend.org_root_hard')?.status).toBe('fail');

    const tooLong = await post(`${base}/posture/waivers`, owner, {
      checkId: 'spend.org_root_hard',
      reason: 'pilot',
      expiresAt: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    });
    expect(tooLong.status).toBe(400);
    const unknownCheck = await post(`${base}/posture/waivers`, owner, {
      checkId: 'nope',
      reason: 'pilot',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(unknownCheck.status).toBe(400);
    const waiver = await body<{ id: string }>(
      await post(`${base}/posture/waivers`, owner, {
        checkId: 'spend.org_root_hard',
        reason: 'budgets arrive next week',
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      }),
    );
    expect((await h.request(`${base}/posture/waivers/${waiver.id}`, { method: 'DELETE', cookie: owner })).status).toBe(
      204,
    );
    const audit = await body<{ events: { action: string }[] }>(await get(`${base}/audit`, owner));
    expect(audit.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['posture.waiver.created', 'posture.waiver.revoked']),
    );
  });

  it('lets members read nothing and auditors read but not waive', async () => {
    const { owner, orgId, base } = await org();
    const member = await joinAs(h, { ownerCookie: owner, orgId, email: email('member'), role: 'member' });
    const auditor = await joinAs(h, { ownerCookie: owner, orgId, email: email('auditor'), role: 'auditor' });
    expect((await get(`${base}/posture`, member)).status).toBe(403);
    expect((await get(`${base}/posture`, auditor)).status).toBe(200);
    const waive = await post(`${base}/posture/waivers`, auditor, {
      checkId: 'keys.age',
      reason: 'test',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(waive.status).toBe(403);
  });
});

describe('inventory and shadow AI', () => {
  it('imports only matched statement rows, never touches the ledger, and escapes CSV formulas', async () => {
    const { owner, orgId, base } = await org();
    await post(`${base}/agents`, owner, { name: '=HYPERLINK("x")' });
    const before = await ledgerRows(orgId);
    const rows = [
      { date: '2026-10-01', amount: '20.00', currency: 'USD', descriptor: 'MIDJOURNEY INC.' },
      { date: '2026-10-02', amount: '20.00', currency: 'USD', descriptor: 'PERPLEXITY.AI' },
      { date: '2026-10-02', amount: '45.00', currency: 'USD', descriptor: 'CARREFOUR MOE' },
      { date: '2026-10-03', amount: '5.00', currency: 'XYZ', descriptor: 'ELEVENLABS.IO' },
    ];
    const upload = await body<{ inserted: number; unmatched: number; noRate: number }>(
      await post(`${base}/external-spend/uploads`, owner, { fileName: 'oct.csv', rows }),
    );
    expect(upload).toMatchObject({ inserted: 2, unmatched: 1, noRate: 1 });
    const again = await body<{ inserted: number; duplicates: number }>(
      await post(`${base}/external-spend/uploads`, owner, { fileName: 'oct.csv', rows }),
    );
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(await ledgerRows(orgId)).toBe(before);

    const list = await body<{ rows: { id: string; toolId: string; status: string }[]; openTotal: string }>(
      await get(`${base}/external-spend`, owner),
    );
    expect(list.rows.map((r) => r.toolId).sort()).toEqual(['midjourney', 'perplexity']);
    expect(list.openTotal).toBe('40.00');
    const midjourney = list.rows.find((r) => r.toolId === 'midjourney');
    expect((await patch(`${base}/external-spend/${midjourney?.id ?? ''}`, owner, { action: 'dismiss' })).status).toBe(
      400,
    );
    expect(
      (
        await patch(`${base}/external-spend/${midjourney?.id ?? ''}`, owner, {
          action: 'dismiss',
          note: 'personal, reimbursed',
        })
      ).status,
    ).toBe(200);

    const inventory = await body<{ rows: { kind: string; status: string }[]; coverage: { basisPoints: number }[] }>(
      await get(`${base}/inventory`, owner),
    );
    expect(inventory.rows.some((r) => r.kind === 'external_tool' && r.status === 'external')).toBe(true);
    expect(inventory.coverage.reduce((sum, s) => sum + s.basisPoints, 0)).toBe(10_000);

    const csv = await (await get(`${base}/inventory.csv`, owner)).text();
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.split('\r\n')[0]).toBe('kind,name,owner,governance,spend_30d_usd,last_activity,detail,id');
  });
});

describe('attestations', () => {
  it('signs, verifies against the public keys, renders a PDF, and shares through revocable links', async () => {
    const { owner, base } = await org();
    const created = await post(`${base}/attestations`, owner, {
      from: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      to: new Date().toISOString(),
    });
    expect(created.status).toBe(201);
    const { id, score } = await body<{ id: string; score: number }>(created);
    expect(typeof score).toBe('number');

    const signed = await body<{ document: { org: { id: string }; disclaimer: string }; jws: string }>(
      await get(`${base}/attestations/${id}`, owner),
    );
    const jwks = await body<{ keys: [] }>(await h.request('/api/v1/public/jwks.json'));
    expect(verifyJws(signed.jws, jwks).payload).toEqual(signed.document);
    expect(signed.document.disclaimer).toMatch(/not a certification/);
    expect(await (await h.request('/.well-known/aperture/jwks.json')).json()).toEqual(jwks);

    const pdf = await get(`${base}/attestations/${id}/pdf`, owner);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 8))).toBe('%PDF-1.4');

    const share = await body<{ id: string; url: string }>(
      await post(`${base}/attestations/${id}/shares`, owner, { expiresInDays: 7 }),
    );
    const token = share.url.split('/a/')[1] ?? '';
    const viewed = await h.request(`/api/v1/public/attestations/${token}`);
    expect(viewed.status).toBe(200);
    expect((await body<{ jws: string }>(viewed)).jws).toBe(signed.jws);
    const shares = await body<{ shares: { views: number }[] }>(await get(`${base}/attestations/${id}/shares`, owner));
    expect(shares.shares[0]?.views).toBe(1);
    await h.request(`${base}/attestations/${id}/shares/${share.id}`, { method: 'DELETE', cookie: owner });
    expect((await h.request(`/api/v1/public/attestations/${token}`)).status).toBe(404);
    expect((await h.request(`/api/v1/public/attestations/${'x'.repeat(43)}`)).status).toBe(404);
  });

  it('refuses periods that end in the future or run longer than a year', async () => {
    const { owner, base } = await org();
    const future = await post(`${base}/attestations`, owner, {
      from: new Date().toISOString(),
      to: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    expect(future.status).toBe(400);
    const long = await post(`${base}/attestations`, owner, {
      from: new Date(Date.now() - 400 * 86_400_000).toISOString(),
      to: new Date().toISOString(),
    });
    expect(long.status).toBe(400);
  });
});

describe('agent cards', () => {
  it('shows one agent on one page, signs it, and only lets owners and admins set the risk tier', async () => {
    const { owner, orgId, base } = await org();
    const agent = await body<{ id: string }>(
      await post(`${base}/agents`, owner, { name: 'analyst', budget: { limit: '5', period: 'day' } }),
    );
    await post(`${base}/principals/${agent.id}/keys`, owner, { name: 'k' });
    const teamLead = await joinAs(h, { ownerCookie: owner, orgId, email: email('lead'), role: 'finance' });

    const updated = await patch(`${base}/agents/${agent.id}/governance`, owner, {
      purpose: 'Summarise support tickets',
      dataClasses: ['customer_personal'],
      riskTier: 'high',
    });
    expect(updated.status).toBe(200);
    expect((await patch(`${base}/agents/${agent.id}/governance`, teamLead, { riskTier: 'low' })).status).toBe(403);

    const card = await body<{
      declared: { purpose: string; riskTier: string; dataClasses: string[] };
      budgets: { scope: string }[];
      means: { keys: { prefix: string }[] };
      governance: string;
    }>(await get(`${base}/agents/${agent.id}/card`, owner));
    expect(card.declared).toEqual({
      purpose: 'Summarise support tickets',
      dataClasses: ['customer_personal'],
      riskTier: 'high',
    });
    expect(card.budgets.some((b) => b.scope === 'principal')).toBe(true);
    expect(card.means.keys).toHaveLength(1);
    expect(card.governance).toBe('enforced');
    const serialized = JSON.stringify(card);
    expect(serialized).not.toMatch(/@acme\.example|"hash"|secret/);

    const { jws } = await body<{ jws: string }>(await get(`${base}/agents/${agent.id}/card.jws`, owner));
    const jwks = await body<{ keys: [] }>(await h.request('/api/v1/public/jwks.json'));
    expect((verifyJws(jws, jwks).payload as { card: { id: string } }).card.id).toBe(agent.id);
  });
});

describe('seats, tools, and terminal telemetry', () => {
  it('imports seats, declares tools, finds unapproved ones, and keeps seats out of the ledger', async () => {
    const { owner, ownerEmail, orgId, base } = await org();
    const member = await joinAs(h, { ownerCookie: owner, orgId, email: 'sara@acme.example', role: 'member' });
    const before = await ledgerRows(orgId);

    const imported = await body<{ seats: number; matched: number }>(
      await post(`${base}/seats/import`, owner, {
        toolId: 'chatgpt',
        plan: 'business',
        rows: [
          {
            email: 'sara@acme.example',
            lastActiveAt: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
          },
          { email: ownerEmail, lastActiveAt: new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10) },
          { email: 'gone@acme.example' },
        ],
      }),
    );
    expect(imported).toEqual({ seats: 3, matched: 2, created: 3 });
    expect(
      (
        await put(`${base}/me/tools`, member, {
          tools: [{ toolId: 'midjourney', plan: 'pro', payer: 'personal_expensed', monthlyCostUsd: '60' }],
        })
      ).status,
    ).toBe(200);
    expect((await put(`${base}/me/tools`, member, { tools: [{ toolId: 'nope', payer: 'company' }] })).status).toBe(400);
    expect((await put(`${base}/tools/approved`, owner, { toolIds: ['chatgpt', 'cursor'] })).status).toBe(200);
    expect((await put(`${base}/tools/approved`, member, { toolIds: [] })).status).toBe(403);

    const seats = await body<{ seats: { toolId: string; source: string }[]; totals: { seats: number } }>(
      await get(`${base}/seats`, owner),
    );
    expect(seats.totals.seats).toBe(4);
    const insights = await body<{ insights: { kind: string; toolId: string }[] }>(
      await get(`${base}/seats/insights`, owner),
    );
    expect(insights.insights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'idle_seat', toolId: 'chatgpt' }),
        expect.objectContaining({ kind: 'unapproved_tool', toolId: 'midjourney' }),
      ]),
    );
    const mine = await body<{ tools: { toolId: string }[]; receiptsAddress: string | null }>(
      await get(`${base}/me/tools`, member),
    );
    expect(mine.tools.map((t) => t.toolId).sort()).toEqual(['chatgpt', 'midjourney']);
    expect(mine.receiptsAddress).toMatch(/^receipts-[a-z0-9]+@in\.aperture\.test$/);
    expect(await ledgerRows(orgId)).toBe(before);
  });

  it('takes Claude Code telemetry with a telemetry token, which can do nothing else', async () => {
    const { owner, orgId, base } = await org();
    const dev = await joinAs(h, { ownerCookie: owner, orgId, email: email('dev'), role: 'member' });
    const created = await body<{ token: string; id: string }>(
      await post(`${base}/me/telemetry-tokens`, dev, { tool: 'claude_code', name: 'laptop' }),
    );
    expect(created.token).toMatch(/^apt_tel_/);
    const time = String(BigInt(Date.now()) * 1_000_000n);
    const exported = {
      resourceMetrics: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }] },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'claude_code.session.count',
                  sum: { aggregationTemporality: 1, dataPoints: [{ timeUnixNano: time, asInt: '1', attributes: [] }] },
                },
                {
                  name: 'claude_code.cost.usage',
                  sum: {
                    aggregationTemporality: 1,
                    dataPoints: [
                      {
                        timeUnixNano: time,
                        asDouble: 0.42,
                        attributes: [
                          { key: 'model', value: { stringValue: 'claude-sonnet-5-5' } },
                          { key: 'prompt', value: { stringValue: 'TOP SECRET merger plans' } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const send = (token: string, init: { contentType?: string; payload?: unknown } = {}) =>
      h.request('/gw/otlp/v1/metrics', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': init.contentType ?? 'application/json' },
        body: JSON.stringify(init.payload ?? exported),
      });
    expect((await send(created.token)).status).toBe(200);
    expect((await send(created.token, { contentType: 'application/x-protobuf' })).status).toBe(415);

    const usage = await body<{ people: { tool: string; sessions: number; cost: string }[] }>(
      await get(`${base}/tool-usage`, owner),
    );
    expect(usage.people[0]).toMatchObject({ tool: 'claude_code', sessions: 1, cost: '0.42' });
    const stored = await h.system.db.select().from(schema.toolUsageDaily).where(eq(schema.toolUsageDaily.orgId, orgId));
    expect(JSON.stringify(stored, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(
      'SECRET',
    );

    // A telemetry token is not a gateway key.
    const chat = await h.request('/gw/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.token}` },
      body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(chat.status).toBe(401);

    expect((await h.request(`${base}/telemetry-tokens/${created.id}`, { method: 'DELETE', cookie: dev })).status).toBe(
      204,
    );
    expect((await send(created.token)).status).toBe(401);
  });

  it('revokes a departing member’s telemetry tokens', async () => {
    const { owner, orgId, base } = await org();
    const dev = await joinAs(h, { ownerCookie: owner, orgId, email: email('leaver'), role: 'member' });
    const { token } = await body<{ token: string }>(
      await post(`${base}/me/telemetry-tokens`, dev, { tool: 'claude_code' }),
    );
    const members = await body<{ members: { id: string; role: string }[] }>(await get(`${base}/members`, owner));
    const leaver = members.members.find((m) => m.role === 'member');
    await h.request(`${base}/members/${leaver?.id ?? ''}`, { method: 'DELETE', cookie: owner });
    const response = await h.request('/gw/otlp/v1/metrics', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resourceMetrics: [] }),
    });
    expect(response.status).toBe(401);
  });

  it('connects a Cursor team, syncs its seats, and refuses a second connection to the same account', async () => {
    const { owner, base } = await org();
    h.provider({
      'GET /teams/members': () =>
        Response.json({ teamMembers: [{ id: 1, email: 'x@acme.example', name: 'X', isRemoved: false }] }),
      'POST /teams/spend': () => Response.json({ teamMemberSpend: [], totalPages: 1 }),
      'POST /teams/daily-usage-data': () => Response.json({ data: [], pagination: { hasNextPage: false } }),
    });
    const connected = await post(`${base}/seat-connections`, owner, {
      provider: 'seat:cursor',
      secret: 'cursor-admin-key',
    });
    expect(connected.status).toBe(201);
    expect(await body(connected)).toMatchObject({ seats: 1 });
    expect(
      (await post(`${base}/seat-connections`, owner, { provider: 'seat:cursor', secret: 'cursor-admin-key' })).status,
    ).toBe(409);
    const list = await body<{ connections: { provider: string; seats: number }[] }>(
      await get(`${base}/seat-connections`, owner),
    );
    expect(list.connections).toEqual([expect.objectContaining({ provider: 'seat:cursor', seats: 1 })]);
  });
});

describe('receipts', () => {
  it('turns an uploaded subscription receipt into a seat, deduplicates, and queues unknown senders for review', async () => {
    const { owner, base } = await org();
    const eml = receiptEml(
      'OpenAI <noreply@tm.openai.com>',
      'Your ChatGPT Plus subscription receipt',
      'ChatGPT Plus Subscription\nDate paid October 5, 2026\nAmount paid $20.00',
    );
    const upload = (raw: string) => post(`${base}/me/receipts`, owner, { eml: Buffer.from(raw).toString('base64') });
    const first = await body<{ status: string; toolId: string; duplicate: boolean }>(await upload(eml));
    expect(first).toMatchObject({ status: 'imported', toolId: 'chatgpt', duplicate: false });
    expect((await body<{ duplicate: boolean }>(await upload(eml))).duplicate).toBe(true);
    const seats = await body<{ seats: { toolId: string; source: string; monthlyCost: string }[] }>(
      await get(`${base}/seats`, owner),
    );
    expect(seats.seats).toEqual([
      expect.objectContaining({ toolId: 'chatgpt', source: 'receipt', monthlyCost: '20.00' }),
    ]);

    const unknown = await body<{ id: string; status: string }>(
      await upload(receiptEml('Shop <a@shop.example>', 'Thanks', 'Total $9.00\nDate: 2026-10-01')),
    );
    expect(unknown.status).toBe('review');
    const queue = await body<{ receipts: { id: string }[] }>(await get(`${base}/receipts?status=review`, owner));
    expect(queue.receipts.map((r) => r.id)).toContain(unknown.id);
    const resolved = await post(`${base}/receipts/${unknown.id}/resolve`, owner, {
      action: 'import',
      toolId: 'replicate',
      oneOff: true,
    });
    expect(resolved.status).toBe(200);
    const external = await body<{ rows: { toolId: string; source: string }[] }>(
      await get(`${base}/external-spend`, owner),
    );
    expect(external.rows).toEqual([expect.objectContaining({ toolId: 'replicate', source: 'receipt' })]);
  });

  it('accepts signed inbound mail for a known address and rejects bad signatures', async () => {
    const { owner, ownerEmail, base } = await org();
    const { receiptsAddress } = await body<{ receiptsAddress: string }>(await get(`${base}/me/tools`, owner));
    const raw = receiptEml(
      `Owner <${ownerEmail}>`,
      'Fwd: Cursor receipt',
      'Begin forwarded message:\nFrom: Cursor <billing@cursor.com>\n\nCursor Pro\nInvoice date: 2026-10-02\nAmount charged $20.00 USD',
    ).replace('receipts-x@in.aperture.test', receiptsAddress);
    const sign = (payload: string, secret = INBOUND_SECRET) =>
      `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    const bad = await h.request('/webhooks/inbound-email', {
      method: 'POST',
      headers: { 'x-aperture-signature': sign(raw, 'wrong-secret-wrong-secret-wrong-secret') },
      body: raw,
    });
    expect(bad.status).toBe(401);
    const good = await h.request('/webhooks/inbound-email', {
      method: 'POST',
      headers: { 'x-aperture-signature': sign(raw) },
      body: raw,
    });
    expect(good.status).toBe(202);
    expect(await body(good)).toMatchObject({ status: 'imported' });
    const seats = await body<{ seats: { toolId: string }[] }>(await get(`${base}/seats`, owner));
    expect(seats.seats.map((s) => s.toolId)).toContain('cursor');
  });
});
