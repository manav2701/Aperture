import { randomBytes } from 'node:crypto';
import { fakeProvider, json } from '@aperture/connectors/testing';
import { keyRingFromEnv } from '@aperture/crypto';
import { connect, count, createConnection, eq, schema, type DatabaseHandle } from '@aperture/db';
import { appRoleUrl, createTestDatabase, seedTree } from '@aperture/db/testing';
import { createLogger } from '@aperture/runtime';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshAllSeatIdleness, runAllPosture, runPosture, syncSeatConnection, type JobDeps } from '../src/index';

let system: DatabaseHandle & { url: string };
let app: DatabaseHandle;
const ring = keyRingFromEnv({ APERTURE_KEK_V1: randomBytes(32).toString('base64') });

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
  email: { send: () => Promise.resolve() },
  webOrigin: 'http://localhost:3000',
  fetch,
});

let counter = 0;
async function member(orgId: string, role: 'owner' | 'member', email = `p${String((counter += 1))}@acme.example`) {
  const userId = `user-${String(counter)}-${String(Date.now())}`;
  await system.db.insert(schema.users).values({ id: userId, name: email, email, emailVerified: true });
  await system.db.insert(schema.members).values({ id: uuidv7(), orgId, userId, role });
  return { userId, email };
}

const alertsOf = (orgId: string) => system.db.select().from(schema.alertLog).where(eq(schema.alertLog.orgId, orgId));

describe('posture runs', () => {
  it('stores a run with an audit checkpoint and alerts only on new critical or high failures', async () => {
    const tree = await seedTree(system.db);
    await member(tree.org.id, 'owner');
    const first = await runPosture(deps(), tree.org.id, 'manual');
    expect(first.result.results.find((r) => r.id === 'access.privileged_2fa')?.status).toBe('fail');
    const [stored] = await system.db.select().from(schema.postureRuns).where(eq(schema.postureRuns.id, first.id));
    expect(stored).toMatchObject({ trigger: 'manual', score: first.result.score });

    // The scheduled run sees the same failures as the manual one: nothing new, no alert.
    await runAllPosture(deps());
    expect((await alertsOf(tree.org.id)).filter((a) => a.kind === 'posture_regression')).toEqual([]);

    // A new critical failure (an unseen card authorization would need Stripe; owners losing 2FA is simpler):
    await member(tree.org.id, 'owner');
    await system.db.update(schema.budgets).set({ archivedAt: new Date() }).where(eq(schema.budgets.scope, 'org'));
    await runAllPosture(deps());
    const regressions = (await alertsOf(tree.org.id)).filter((a) => a.kind === 'posture_regression');
    expect(regressions.map((a) => (a.payload as { check: string }).check)).toContain('spend.org_root_hard');
  });

  it('warns about waivers that expire within a week', async () => {
    const tree = await seedTree(system.db);
    const owner = await member(tree.org.id, 'owner');
    await system.db.insert(schema.postureWaivers).values({
      id: uuidv7(),
      orgId: tree.org.id,
      checkId: 'keys.age',
      reason: 'rotating next sprint',
      createdBy: owner.userId,
      expiresAt: new Date(Date.now() + 3 * 86_400_000),
    });
    await runAllPosture(deps());
    expect((await alertsOf(tree.org.id)).map((a) => a.kind)).toContain('waiver_expiring');
  });
});

describe('seat sync', () => {
  const cursorFake = (requests: number) =>
    fakeProvider({
      'GET /teams/members': json({
        teamMembers: [
          { id: 1, email: 'Dev@Acme.example', name: 'Dev', role: 'member', isRemoved: false },
          { id: 2, email: 'contractor@elsewhere.example', name: 'C', role: 'member', isRemoved: false },
        ],
      }),
      'POST /teams/spend': json({
        teamMemberSpend: [{ email: 'dev@acme.example', spendCents: 500 }],
        subscriptionCycleStart: Date.parse('2026-10-01T00:00:00Z'),
        totalPages: 1,
      }),
      'POST /teams/daily-usage-data': json({
        data: [
          {
            userId: 1,
            email: 'dev@acme.example',
            day: new Date().toISOString().slice(0, 10),
            isActive: true,
            chatRequests: requests,
          },
        ],
        pagination: { hasNextPage: false },
      }),
    });

  it('matches seats to members by email, replaces re-read days, and never touches the ledger', async () => {
    const tree = await seedTree(system.db);
    const dev = await member(tree.org.id, 'member', 'dev@acme.example');
    const created = await createConnection(system.db, ring, {
      orgId: tree.org.id,
      provider: 'seat:cursor',
      name: 'Cursor',
      secret: 'key',
    });
    const [conn] = await system.db.select().from(schema.connections).where(eq(schema.connections.id, created.id));
    if (conn === undefined) throw new Error('connection missing');
    const ledgerBefore = (
      await system.db
        .select({ n: count() })
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.orgId, tree.org.id))
    )[0]?.n;

    const result = await syncSeatConnection(deps(cursorFake(4).fetch), conn);
    expect(result).toMatchObject({ seats: 2, matched: 1, days: 1 });
    await syncSeatConnection(deps(cursorFake(9).fetch), conn);

    const seats = await system.db.select().from(schema.seats).where(eq(schema.seats.orgId, tree.org.id));
    expect(seats).toHaveLength(2);
    const devSeat = seats.find((s) => s.userId === dev.userId);
    expect(devSeat).toMatchObject({ toolId: 'cursor', source: 'connector', payer: 'company', plan: 'teams' });
    expect(devSeat?.lastActiveAt).not.toBeNull();
    expect(seats.find((s) => s.userId === null)?.externalUserRef).toBe('contractor@elsewhere.example');

    const days = await system.db
      .select()
      .from(schema.seatUsageDaily)
      .where(eq(schema.seatUsageDaily.orgId, tree.org.id));
    const today = days.find((d) => d.day === new Date().toISOString().slice(0, 10));
    expect(today?.requests).toBe(9);
    expect(days.find((d) => d.day === '2026-10-01')?.extraUsageCost).toBe(5_000_000n);

    const ledgerAfter = (
      await system.db
        .select({ n: count() })
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.orgId, tree.org.id))
    )[0]?.n;
    expect(ledgerAfter).toBe(ledgerBefore);
  });

  it('marks seats idle past the org threshold, active again on use, and leaves declared seats alone', async () => {
    const tree = await seedTree(system.db);
    const created = await createConnection(system.db, ring, {
      orgId: tree.org.id,
      provider: 'seat:cursor',
      name: 'Cursor',
      secret: 'key',
    });
    const [conn] = await system.db.select().from(schema.connections).where(eq(schema.connections.id, created.id));
    if (conn === undefined) throw new Error('connection missing');
    await system.db.insert(schema.seats).values({
      id: uuidv7(),
      orgId: tree.org.id,
      toolId: 'chatgpt',
      source: 'declared',
      dedupeKey: 'declared:someone:chatgpt',
    });
    await system.db
      .insert(schema.orgSettings)
      .values({ orgId: tree.org.id, idleSeatDays: 14 })
      .onConflictDoUpdate({
        target: schema.orgSettings.orgId,
        set: { idleSeatDays: 14 },
      });

    await syncSeatConnection(deps(cursorFake(4).fetch), conn);
    const statuses = async () =>
      Object.fromEntries(
        (await system.db.select().from(schema.seats).where(eq(schema.seats.orgId, tree.org.id))).map((s) => [
          s.externalUserRef ?? s.source,
          s.status,
        ]),
      );
    // The contractor never shows activity; the developer used Cursor today.
    expect(await statuses()).toEqual({
      'dev@acme.example': 'active',
      'contractor@elsewhere.example': 'idle',
      declared: 'active',
    });

    const later = new Date(Date.now() + 15 * 86_400_000);
    expect(await refreshAllSeatIdleness(deps(), later)).toBeGreaterThanOrEqual(1);
    expect((await statuses())['dev@acme.example']).toBe('idle');
    expect((await statuses()).declared).toBe('active');

    // Running again changes nothing; activity coming back makes the seat active.
    await refreshAllSeatIdleness(deps(), later);
    await syncSeatConnection(deps(cursorFake(2).fetch), conn);
    expect((await statuses())['dev@acme.example']).toBe('active');
  });

  it('marks the connection broken and alerts when the vendor refuses the key', async () => {
    const tree = await seedTree(system.db);
    const created = await createConnection(system.db, ring, {
      orgId: tree.org.id,
      provider: 'seat:cursor',
      name: 'Cursor',
      secret: 'bad',
    });
    const [conn] = await system.db.select().from(schema.connections).where(eq(schema.connections.id, created.id));
    if (conn === undefined) throw new Error('connection missing');
    const refusing = fakeProvider({
      'GET /teams/members': json({ error: 'unauthorized' }, 401),
      'POST /teams/spend': json({ error: 'unauthorized' }, 401),
      'POST /teams/daily-usage-data': json({ error: 'unauthorized' }, 401),
    });
    await expect(syncSeatConnection(deps(refusing.fetch), conn)).rejects.toThrow();
    const [after] = await system.db.select().from(schema.connections).where(eq(schema.connections.id, conn.id));
    expect(after?.status).toBe('broken');
    expect((await alertsOf(tree.org.id)).map((a) => a.kind)).toContain('connection_broken');
  });
});
