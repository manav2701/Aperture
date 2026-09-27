import { randomBytes } from 'node:crypto';
import { fakeProvider, json } from '@aperture/connectors/testing';
import { authorizationObject, transactionObject } from '@aperture/cards/testing';
import { encryptSecret, keyRingFromEnv } from '@aperture/crypto';
import {
  and,
  connect,
  createConnection,
  createPrincipal,
  eq,
  schema,
  requestApproval,
  upsertPrices,
  withSystem,
  type DatabaseHandle,
} from '@aperture/db';
import { appRoleUrl, createTestDatabase, seedTree, usd } from '@aperture/db/testing';
import { createLogger, type Email } from '@aperture/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dispatchAlerts,
  expirePendingApprovals,
  expireTaskCards,
  reconcileCards,
  syncFxRates,
  notifyApprovals,
  scanBudgetThresholds,
  startScheduler,
  syncConnection,
  type JobDeps,
} from '../src/index';

let system: DatabaseHandle & { url: string };
let app: DatabaseHandle;
const ring = keyRingFromEnv({ APERTURE_KEK_V1: randomBytes(32).toString('base64') });
const sent: Email[] = [];

beforeAll(async () => {
  system = await createTestDatabase();
  app = connect(appRoleUrl(system.url));
});
afterAll(async () => {
  await app.close();
  await system.close();
});

const deps = (fetch?: JobDeps['fetch']): JobDeps => ({
  database: app,
  ring,
  logger: createLogger({ service: 'jobs-test', level: 'silent' }),
  email: {
    send: (email) => {
      sent.push(email);
      return Promise.resolve();
    },
  },
  webOrigin: 'http://localhost:3000',
  fetch,
});

async function connection(orgId: string, provider: string, config: Record<string, unknown> = {}) {
  const created = await createConnection(system.db, ring, {
    orgId,
    provider,
    name: provider,
    secret: 'admin-secret',
    config,
  });
  const [row] = await system.db.select().from(schema.connections).where(eq(schema.connections.id, created.id));
  if (!row) throw new Error('connection missing');
  return row;
}

const orKey = (hash: string, usage: number, limit: number | null = null) => ({
  hash,
  name: `key ${hash}`,
  label: 'sk-or-v1-a...z',
  disabled: false,
  usage,
  limit,
});

async function credentialsOf(connectionId: string) {
  return system.db.select().from(schema.credentials).where(eq(schema.credentials.connectionId, connectionId));
}

async function observedFor(orgId: string) {
  return system.db
    .select()
    .from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.orgId, orgId), eq(schema.ledgerEntries.rail, 'provider')));
}

describe('OpenRouter sync (key totals, T1 limit mirroring)', () => {
  it('imports only spend after connecting, charges the key’s principal, and mirrors the budget as a limit', async () => {
    const tree = await seedTree(system.db, { agent: '5' });
    const conn = await connection(tree.org.id, 'openrouter');
    let usage = 89.5;
    const provider = fakeProvider({
      'GET /api/v1/keys': (call) =>
        Response.json({
          data: call.url.searchParams.get('offset') === '0' ? [orKey('h1', usage, null), orKey('h2', 1)] : [],
        }),
      'PATCH /api/v1/keys/h1': json({ data: orKey('h1', 0) }),
    });

    // First sync: keys arrive unassigned; historical spend is a baseline, not a charge.
    await syncConnection(deps(provider.fetch), conn);
    expect(await observedFor(tree.org.id)).toEqual([]);
    const [h1] = (await credentialsOf(conn.id)).filter((c) => c.externalId === 'h1');
    expect(h1).toMatchObject({ principalId: null, lastUsage: usd('89.5') });

    await system.db
      .update(schema.credentials)
      .set({ principalId: tree.agent.id, createdByAperture: true })
      .where(eq(schema.credentials.id, h1?.id ?? ''));

    usage = 89.9;
    const result = await syncConnection(deps(provider.fetch), conn);
    expect(result).toMatchObject({ imported: 1, limitsUpdated: 1 });
    const entries = await observedFor(tree.org.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'observed', principalId: tree.agent.id, amount: usd('0.4') });

    // Limit = lifetime usage + remaining: 89.9 + (5 - 0.4).
    const patch = provider.calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ limit: 94.5 });

    // Replaying the same totals books nothing new.
    await syncConnection(deps(provider.fetch), conn);
    expect(await observedFor(tree.org.id)).toHaveLength(1);
  });

  it('charges spend on unassigned keys to the org’s “Unassigned” principal', async () => {
    const tree = await seedTree(system.db);
    const conn = await connection(tree.org.id, 'openrouter');
    let usage = 1;
    const provider = fakeProvider({
      'GET /api/v1/keys': (call) =>
        Response.json({ data: call.url.searchParams.get('offset') === '0' ? [orKey('u1', usage)] : [] }),
    });
    await syncConnection(deps(provider.fetch), conn);
    usage = 1.25;
    await syncConnection(deps(provider.fetch), conn);
    const [entry] = await observedFor(tree.org.id);
    const [unassigned] = await system.db
      .select()
      .from(schema.principals)
      .where(and(eq(schema.principals.orgId, tree.org.id), eq(schema.principals.systemRole, 'unassigned')));
    expect(entry?.principalId).toBe(unassigned?.id);
    expect(entry?.amount).toBe(usd('0.25'));
  });

  it('marks the connection broken when the key stops working', async () => {
    const tree = await seedTree(system.db);
    const conn = await connection(tree.org.id, 'openrouter');
    const provider = fakeProvider({ 'GET /api/v1/keys': json({ error: 'revoked' }, 401) });
    await expect(syncConnection(deps(provider.fetch), conn)).rejects.toMatchObject({ code: 'unauthorized' });
    const [row] = await system.db.select().from(schema.connections).where(eq(schema.connections.id, conn.id));
    expect(row).toMatchObject({ status: 'broken' });
    expect(row?.lastError).toContain('unauthorized');
    const alerts = await system.db.select().from(schema.alertLog).where(eq(schema.alertLog.orgId, tree.org.id));
    expect(alerts.map((a) => a.kind)).toEqual(['connection_broken']);
  });
});

describe('Anthropic sync (buckets, T2 revoke on breach)', () => {
  it('prices usage from the catalog, revokes the key when the hard budget runs out, and books late revisions as adjustments', async () => {
    await withSystem(system.db, (tx) =>
      upsertPrices(tx, [
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          inputPerMTok: 3_000_000n,
          outputPerMTok: 15_000_000n,
          cacheReadPerMTok: null,
          cacheWritePerMTok: null,
          source: 'test',
        },
      ]),
    );
    const tree = await seedTree(system.db, { agent: '1' });
    const conn = await connection(tree.org.id, 'anthropic');
    await system.db.insert(schema.credentials).values({
      id: crypto.randomUUID(),
      orgId: tree.org.id,
      connectionId: conn.id,
      principalId: tree.agent.id,
      externalId: 'apikey_1',
      name: 'research key',
    });

    let outputTokens = 100_000; // 100k × $15/M = $1.50 > $1 budget
    // A bucket from a few minutes ago, so the spend lands in today's budget period.
    const start = new Date(Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000);
    const bucket = () => ({
      starting_at: start.toISOString(),
      ending_at: new Date(start.getTime() + 60_000).toISOString(),
      results: [
        {
          api_key_id: 'apikey_1',
          model: 'claude-sonnet-4-5-20250929',
          uncached_input_tokens: 0,
          output_tokens: outputTokens,
        },
      ],
    });
    const provider = fakeProvider({
      'GET /v1/organizations/api_keys': json({
        data: [{ id: 'apikey_1', name: 'research key', status: 'active' }],
        has_more: false,
      }),
      'GET /v1/organizations/usage_report/messages': () => Response.json({ data: [bucket()], has_more: false }),
      'POST /v1/organizations/api_keys/apikey_1': json({ id: 'apikey_1', status: 'inactive' }),
    });

    const result = await syncConnection(deps(provider.fetch), conn);
    expect(result).toMatchObject({ imported: 1, revoked: 1 });
    expect(provider.calls.find((c) => c.method === 'POST')?.body).toEqual({ status: 'inactive' });
    const [credential] = await credentialsOf(conn.id);
    expect(credential?.status).toBe('revoked');
    const audit = await system.db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.orgId, tree.org.id), eq(schema.auditEvents.action, 'credential.revoked')));
    expect(audit[0]?.actor).toBe('system:connector-sync');

    // The provider revises the bucket upwards: only the difference is booked.
    outputTokens = 120_000;
    await syncConnection(deps(provider.fetch), conn);
    const entries = await observedFor(tree.org.id);
    expect(entries.map((e) => [e.kind, e.amount])).toEqual([
      ['observed', usd('1.5')],
      ['adjustment', usd('0.3')],
    ]);
  });
});

describe('alerts', () => {
  it('alerts once per threshold per period and emails owners', async () => {
    const tree = await seedTree(system.db, { org: '10' });
    const user = await system.db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        name: 'Owner',
        email: `owner-${tree.org.id}@example.com`,
        emailVerified: true,
      })
      .returning();
    await system.db
      .insert(schema.members)
      .values({ id: crypto.randomUUID(), orgId: tree.org.id, userId: user[0]?.id ?? '', role: 'owner' });
    const spender = await createPrincipal(system.db, { orgId: tree.org.id, kind: 'agent', name: 'spender' });
    const { recordSpend } = await import('@aperture/db');
    await recordSpend(system.db, {
      orgId: tree.org.id,
      principalId: spender.id,
      rail: 'provider',
      kind: 'observed',
      amount: usd('8.5'),
      idempotencyKey: 'alert-test',
    });

    await scanBudgetThresholds(deps());
    await scanBudgetThresholds(deps());
    const alerts = await system.db.select().from(schema.alertLog).where(eq(schema.alertLog.orgId, tree.org.id));
    expect(alerts.map((a) => (a.payload as { threshold: number }).threshold)).toEqual([80]);

    sent.length = 0;
    expect(await dispatchAlerts(deps())).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((email) => email.to === `owner-${tree.org.id}@example.com`);
    expect(mine[0]?.subject).toBe('Budget "Org" reached 80%');
    expect(mine[0]?.text).toContain('$8.50 of its $10.00 monthly limit');
  });
});

describe('approvals', () => {
  it('emails approvers once per request, and denies requests nobody decided in time', async () => {
    const tree = await seedTree(system.db);
    const [owner] = await system.db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        name: 'Owner',
        email: `approver-${tree.org.id}@example.com`,
        emailVerified: true,
      })
      .returning();
    await system.db
      .insert(schema.members)
      .values({ id: crypto.randomUUID(), orgId: tree.org.id, userId: owner?.id ?? '', role: 'owner' });
    const approval = await requestApproval(system.db, {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'gateway',
      resource: 'openrouter:openai/gpt-4o',
      amount: usd('2.5'),
      purpose: 'weekly report',
      context: {},
    });
    await notifyApprovals(deps());
    await notifyApprovals(deps());
    sent.length = 0;
    await dispatchAlerts(deps());
    const mine = sent.filter((email) => email.to === `approver-${tree.org.id}@example.com`);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.subject).toBe('research-bot is asking to spend up to $2.50');
    expect(mine[0]?.text).toContain(`/orgs/${tree.org.id}/approvals`);

    await system.db
      .update(schema.approvals)
      .set({ expiresAt: new Date(Date.now() - 3_600_000) })
      .where(eq(schema.approvals.id, approval.id));
    expect(await expirePendingApprovals(deps())).toBeGreaterThanOrEqual(1);
    const [expired] = await system.db.select().from(schema.approvals).where(eq(schema.approvals.id, approval.id));
    expect(expired?.status).toBe('expired');
  });
});

describe('cards upkeep (Phase 8)', () => {
  it('syncs FX with GCC pegs, replays missed Stripe events, and cancels unused task cards', async () => {
    const fx = fakeProvider({ 'GET /v1/latest': json({ base: 'USD', rates: { EUR: 0.8, JPY: 150 } }) });
    expect(await syncFxRates(deps(fx.fetch))).toBeGreaterThanOrEqual(8);
    const rates = await system.db.select().from(schema.fxRates);
    expect(rates.find((r) => r.currency === 'eur')?.microsPerUnit).toBe(1_250_000n);
    expect(rates.find((r) => r.currency === 'aed')?.microsPerUnit).toBe(272_295n);

    const tree = await seedTree(system.db, { agent: '100', agentPeriod: 'month' });
    const connectionId = crypto.randomUUID();
    await system.db.insert(schema.connections).values({
      id: connectionId,
      orgId: tree.org.id,
      provider: 'stripe_issuing',
      name: 'Stripe Issuing',
      secret: encryptSecret(
        JSON.stringify({ apiKey: 'rk_test_x', authorizationSecret: 'whsec_a', eventsSecret: 'whsec_e' }),
        `${tree.org.id}|${connectionId}`,
        ring,
      ),
      config: { cardholderId: 'ich_1' },
    });
    const card = async (externalId: string, extra: Record<string, unknown> = {}) =>
      system.db.insert(schema.cards).values({
        id: crypto.randomUUID(),
        orgId: tree.org.id,
        connectionId,
        principalId: tree.agent.id,
        externalId,
        kind: 'agent',
        ...extra,
      });
    await card('ic_rec1');
    await card('ic_task1', { kind: 'task', expiresAt: new Date(Date.now() - 3_600_000) });

    // Webhooks never arrived: Stripe approved on timeout and captured. Reconciliation finds it.
    const auth = authorizationObject({
      card: 'ic_rec1',
      amount: 900,
      status: 'closed',
      pending: null,
      history: [{ approved: true, reason: 'webhook_timeout' }],
    });
    const stripe = fakeProvider({
      'GET /v1/issuing/authorizations': json({ object: 'list', data: [auth], has_more: false }),
      'GET /v1/issuing/transactions': json({
        object: 'list',
        data: [transactionObject({ card: 'ic_rec1', authorization: auth.id, amount: 900 })],
        has_more: false,
      }),
      'POST /v1/issuing/cards/ic_task1': json({ id: 'ic_task1', status: 'canceled' }),
    });
    const first = await reconcileCards(deps(stripe.fetch));
    expect(first).toMatchObject({ timeouts: 1 });
    const again = await reconcileCards(deps(stripe.fetch));
    expect(again.replayed).toBe(0);
    const usage = await system.db
      .select()
      .from(schema.budgetUsage)
      .where(eq(schema.budgetUsage.budgetId, tree.agentBudget.id));
    expect(usage.reduce((sum, row) => sum + row.spent, 0n)).toBe(usd('9'));
    const alerts = await system.db.select().from(schema.alertLog).where(eq(schema.alertLog.orgId, tree.org.id));
    expect(alerts.map((a) => a.kind).sort()).toEqual(['card_decisions_timing_out', 'card_unseen_authorization']);

    expect(await expireTaskCards(deps(stripe.fetch))).toBeGreaterThanOrEqual(1);
    const [task] = await system.db.select().from(schema.cards).where(eq(schema.cards.externalId, 'ic_task1'));
    expect(task?.status).toBe('canceled');
  });
});

describe('scheduler', () => {
  it('never runs the same job in two places at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const jobs = [
      {
        name: `slow-${String(Date.now())}`,
        everyMs: 3_600_000,
        run: async () => {
          runs += 1;
          await gate;
        },
      },
    ];
    const logger = createLogger({ service: 'jobs-test', level: 'silent' });
    const a = startScheduler({ database: app, logger, jobs });
    const b = startScheduler({ database: app, logger, jobs });
    const first = a.runNow(jobs[0]?.name ?? '');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await b.runNow(jobs[0]?.name ?? '')).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
    await a.stop();
    await b.stop();
  });
});
