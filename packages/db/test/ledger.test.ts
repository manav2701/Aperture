import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '../src/client';
import { createBudget, createPrincipal, setBudgetLimit } from '../src/entities';
import {
  LedgerError,
  adjust,
  expireHolds,
  recordSpend,
  refund,
  release,
  reserve,
  settle,
  verifyCounters,
} from '../src/ledger';
import { budgetUsage, budgets, holds, ledgerEntries, principals } from '../src/schema';
import { createTestDatabase } from './database';
import { expectDbError, nextKey, reserveInput, reserveOk, seedTree, usageOf, usd } from './fixtures';

let handle: DatabaseHandle;
beforeAll(async () => {
  handle = await createTestDatabase();
});
afterAll(async () => {
  await handle.close();
});

describe('reserve / settle / release', () => {
  it('holds, then converts to spend on every budget in the path', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const hold = await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('2')));
    for (const budget of [tree.orgBudget, tree.teamBudget, tree.agentBudget]) {
      expect(await usageOf(db, budget.id)).toEqual({ held: usd('2'), spent: 0n });
    }

    const settled = await settle(db, { orgId: tree.org.id, holdId: hold.id, actualAmount: usd('1.5') });
    expect(settled).toEqual({ overage: false, replayed: false });
    for (const budget of [tree.orgBudget, tree.teamBudget, tree.agentBudget]) {
      expect(await usageOf(db, budget.id)).toEqual({ held: 0n, spent: usd('1.5') });
    }
    expect((await verifyCounters(db, tree.org.id)).ok).toBe(true);
  });

  it('flags overage when the actual cost exceeds the hold (L6)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const hold = await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('1')));
    expect(await settle(db, { orgId: tree.org.id, holdId: hold.id, actualAmount: usd('1.25') })).toEqual({
      overage: true,
      replayed: false,
    });
    const [capture] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, `capture:${hold.id}`));
    expect(capture?.meta).toMatchObject({ overage: true, holdAmount: usd('1').toString() });
  });

  it('is idempotent and refuses conflicting repeats (L3)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const input = reserveInput(tree.org.id, tree.agent.id, usd('1'));
    const first = await reserve(db, input);
    const again = await reserve(db, input);
    expect(first.ok && again.ok && again.replayed && again.hold.id === first.hold.id).toBe(true);
    await expect(reserve(db, { ...input, amount: usd('2') })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(await usageOf(db, tree.agentBudget.id)).toEqual({ held: usd('1'), spent: 0n });

    const holdId = first.ok ? first.hold.id : '';
    await settle(db, { orgId: tree.org.id, holdId, actualAmount: usd('1') });
    expect((await settle(db, { orgId: tree.org.id, holdId, actualAmount: usd('1') })).replayed).toBe(true);
    await expect(settle(db, { orgId: tree.org.id, holdId, actualAmount: usd('2') })).rejects.toMatchObject({
      code: 'hold_not_open',
    });
    await expect(release(db, { orgId: tree.org.id, holdId })).rejects.toMatchObject({ code: 'hold_not_open' });
  });

  it('release returns the money and is idempotent', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const hold = await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('3')));
    await release(db, { orgId: tree.org.id, holdId: hold.id });
    expect((await release(db, { orgId: tree.org.id, holdId: hold.id })).replayed).toBe(true);
    expect(await usageOf(db, tree.orgBudget.id)).toEqual({ held: 0n, spent: 0n });
    await expect(settle(db, { orgId: tree.org.id, holdId: hold.id, actualAmount: 1n })).rejects.toBeInstanceOf(
      LedgerError,
    );
  });

  it('rejects invalid amounts', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    for (const amount of [0n, -1n, 2n ** 63n]) {
      await expect(reserve(db, reserveInput(tree.org.id, tree.agent.id, amount))).rejects.toMatchObject({
        code: 'invalid_amount',
      });
    }
  });
});

describe('budget checks', () => {
  it('denies at the first budget that would be exceeded, naming it, even if lower budgets have room', async () => {
    const { db } = handle;
    const tree = await seedTree(db, { org: '100', team: '5', agent: '50' });
    await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('4')));
    const denied = await reserve(db, reserveInput(tree.org.id, tree.agent.id, usd('2')));
    expect(denied).toMatchObject({
      ok: false,
      reason: 'budget_exceeded',
      budgetId: tree.teamBudget.id,
      budgetName: 'Marketing',
      used: usd('4'),
      remaining: usd('1'),
    });
  });

  it('allows spending exactly up to the limit', async () => {
    const { db } = handle;
    const tree = await seedTree(db, { agent: '2' });
    await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('1.5')));
    await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('0.5')));
    expect((await reserve(db, reserveInput(tree.org.id, tree.agent.id, 1n))).ok).toBe(false);
  });

  it('fails closed without a budget, and for paused principals (kill switch)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const stranger = await createPrincipal(db, { orgId: tree.org.id, kind: 'agent', name: 'no-budget' });
    expect(await reserve(db, reserveInput(tree.org.id, stranger.id, usd('1')))).toEqual({
      ok: false,
      reason: 'no_budget',
    });

    await db.update(principals).set({ status: 'paused' }).where(eq(principals.id, tree.agent.id));
    expect(await reserve(db, reserveInput(tree.org.id, tree.agent.id, usd('1')))).toEqual({
      ok: false,
      reason: 'principal_inactive',
    });
    await expect(reserve(db, reserveInput(tree.org.id, tree.org.id, usd('1')))).rejects.toMatchObject({
      code: 'principal_not_found',
    });
  });

  it('lets soft budgets go over and reports threshold crossings', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const soft = await createBudget(db, {
      orgId: tree.org.id,
      name: 'Soft weekly',
      scope: 'principal',
      scopeId: tree.agent.id,
      period: 'week',
      limit: usd('1'),
      mode: 'soft',
      alertThresholds: [50, 80, 100],
    });
    const first = await reserve(db, reserveInput(tree.org.id, tree.agent.id, usd('0.6')));
    expect(first.ok && first.thresholdCrossings.map((c) => c.thresholdPercent)).toEqual([50]);
    const second = await reserve(db, reserveInput(tree.org.id, tree.agent.id, usd('0.6')));
    expect(second.ok && second.thresholdCrossings.map((c) => [c.budgetId, c.thresholdPercent])).toEqual([
      [soft.id, 80],
      [soft.id, 100],
    ]);
  });

  it('enforces velocity with count budgets (G9)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    await createBudget(db, {
      orgId: tree.org.id,
      name: '3 requests per hour',
      scope: 'principal',
      scopeId: tree.agent.id,
      unit: 'count',
      period: 'hour',
      limit: 3n,
    });
    for (let i = 0; i < 3; i += 1) await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, 1n));
    expect(await reserve(db, reserveInput(tree.org.id, tree.agent.id, 1n))).toMatchObject({
      ok: false,
      budgetName: '3 requests per hour',
    });
  });

  it('applies rail-specific budgets only to their rails', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    await createBudget(db, {
      orgId: tree.org.id,
      name: 'Cards only',
      scope: 'principal',
      scopeId: tree.agent.id,
      period: 'month',
      limit: usd('1'),
      rails: ['card'],
    });
    await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('5')));
    expect(await reserve(db, reserveInput(tree.org.id, tree.agent.id, usd('5'), { rail: 'card' }))).toMatchObject({
      ok: false,
      budgetName: 'Cards only',
    });
  });

  it('enforces an extra mandate budget', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const mandate = await createBudget(db, {
      orgId: tree.org.id,
      parentId: tree.agentBudget.id,
      name: 'Mandate: Q4 research',
      scope: 'mandate',
      period: 'none',
      limit: usd('1'),
    });
    expect(
      await reserve(db, reserveInput(tree.org.id, tree.agent.id, usd('2'), { mandateBudgetId: mandate.id })),
    ).toMatchObject({ ok: false, budgetId: mandate.id });
    expect((await reserve(db, reserveInput(tree.org.id, tree.agent.id, usd('2')))).ok).toBe(true);
  });

  it('keeps enforcing after a limit is lowered below current spend (L9)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('10')));
    await setBudgetLimit(db, { orgId: tree.org.id, budgetId: tree.agentBudget.id, limit: usd('4') });
    expect(await reserve(db, reserveInput(tree.org.id, tree.agent.id, 1n))).toMatchObject({
      ok: false,
      budgetId: tree.agentBudget.id,
      remaining: 0n,
    });
  });

  it('settles into the period the hold was reserved in, even after the period ends (L7)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const hold = await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('1')));
    // Simulate a hold reserved yesterday (Dubai) that settles today.
    const agentIndex = hold.budgetIds.indexOf(tree.agentBudget.id);
    const yesterday = [...hold.periodKeys];
    yesterday[agentIndex] = '2026-01-01';
    await db.update(holds).set({ periodKeys: yesterday }).where(eq(holds.id, hold.id));
    await db.insert(budgetUsage).values({ budgetId: tree.agentBudget.id, periodKey: '2026-01-01', held: usd('1') });
    await db.execute(sql`update budget_usage set held = held - ${usd('1').toString()}::bigint
      where budget_id = ${tree.agentBudget.id} and period_key <> '2026-01-01'`);

    await settle(db, { orgId: tree.org.id, holdId: hold.id, actualAmount: usd('1') });
    const rows = await db.select().from(budgetUsage).where(eq(budgetUsage.budgetId, tree.agentBudget.id));
    expect(rows.find((row) => row.periodKey === '2026-01-01')).toMatchObject({ held: 0n, spent: usd('1') });
  });
});

describe('expiry', () => {
  it('settles, releases, or parks holds for reconciliation per their onExpiry action', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const toSettle = await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('1'), { onExpiry: 'settle' }));
    const toRelease = await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('2'), { onExpiry: 'release' }));
    const toReconcile = await reserveOk(
      db,
      reserveInput(tree.org.id, tree.agent.id, usd('4'), { onExpiry: 'reconcile' }),
    );
    const fresh = await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('8')));
    await db
      .update(holds)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(
        sql`id in (${sql.join(
          [toSettle.id, toRelease.id, toReconcile.id].map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );

    expect(await expireHolds(db, { orgId: tree.org.id })).toEqual({ settled: 1, released: 1, reconciling: 1 });
    const statuses = Object.fromEntries(
      (await db.select().from(holds).where(eq(holds.orgId, tree.org.id))).map((hold) => [hold.id, hold.status]),
    );
    expect(statuses).toEqual({
      [toSettle.id]: 'settled',
      [toRelease.id]: 'released',
      [toReconcile.id]: 'expired_reconciling',
      [fresh.id]: 'open',
    });
    // Reconciling holds keep their money held until the real outcome is known (I3).
    expect(await usageOf(db, tree.agentBudget.id)).toEqual({ held: usd('12'), spent: usd('1') });
    await settle(db, { orgId: tree.org.id, holdId: toReconcile.id, actualAmount: usd('3') });
    expect(await usageOf(db, tree.agentBudget.id)).toEqual({ held: usd('8'), spent: usd('4') });
    expect((await verifyCounters(db, tree.org.id)).ok).toBe(true);
  });
});

describe('spend without a hold, refunds, adjustments', () => {
  it('records unheld spend even over budget and reports the breach (K7)', async () => {
    const { db } = handle;
    const tree = await seedTree(db, { agent: '1' });
    const input = {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'card' as const,
      kind: 'unheld_capture' as const,
      amount: usd('5'),
      idempotencyKey: nextKey('force-capture'),
    };
    const result = await recordSpend(db, input);
    expect(result.overBudget.map((breach) => breach.budgetId)).toEqual([tree.agentBudget.id]);
    expect(await usageOf(db, tree.agentBudget.id)).toEqual({ held: 0n, spent: usd('5') });
    expect((await recordSpend(db, input)).replayed).toBe(true);
    await expect(recordSpend(db, { ...input, amount: usd('6') })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });

  it('counts observed usage in the period it happened', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const result = await recordSpend(db, {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'provider',
      kind: 'observed',
      amount: usd('1'),
      idempotencyKey: nextKey('observed'),
      occurredAt: new Date('2026-03-15T21:30:00Z'), // 16 March in Dubai
    });
    const agentIndex = result.entry.budgetIds.indexOf(tree.agentBudget.id);
    expect(result.entry.periodKeys[agentIndex]).toBe('2026-03-16');
  });

  it('refunds credit the current period and never exceed the original (L13)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const hold = await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('10')));
    await settle(db, { orgId: tree.org.id, holdId: hold.id, actualAmount: usd('10') });
    const [capture] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, `capture:${hold.id}`));
    const originalEntryId = capture?.id ?? '';

    const key = nextKey('refund');
    await refund(db, { orgId: tree.org.id, originalEntryId, amount: usd('4'), idempotencyKey: key });
    expect(
      (await refund(db, { orgId: tree.org.id, originalEntryId, amount: usd('4'), idempotencyKey: key })).replayed,
    ).toBe(true);
    expect(await usageOf(db, tree.agentBudget.id)).toEqual({ held: 0n, spent: usd('6') });
    await expect(
      refund(db, { orgId: tree.org.id, originalEntryId, amount: usd('6.000001'), idempotencyKey: nextKey('refund') }),
    ).rejects.toMatchObject({ code: 'refund_exceeds_original' });
    expect((await verifyCounters(db, tree.org.id)).ok).toBe(true);
  });

  it('applies signed adjustments to money budgets only', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const velocity = await createBudget(db, {
      orgId: tree.org.id,
      name: 'velocity',
      scope: 'principal',
      scopeId: tree.agent.id,
      unit: 'count',
      period: 'hour',
      limit: 10n,
    });
    await adjust(db, {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'provider',
      amount: usd('2'),
      idempotencyKey: nextKey('adj'),
    });
    await adjust(db, {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'provider',
      amount: -1n * usd('0.5'),
      idempotencyKey: nextKey('adj'),
    });
    expect(await usageOf(db, tree.agentBudget.id)).toEqual({ held: 0n, spent: usd('1.5') });
    expect(await usageOf(db, velocity.id)).toEqual({ held: 0n, spent: 0n });
    expect((await verifyCounters(db, tree.org.id)).ok).toBe(true);
  });
});

describe('integrity', () => {
  it('detects counters that drift from the journal (L8)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('1')));
    await db.update(budgetUsage).set({ held: 0n }).where(eq(budgetUsage.budgetId, tree.teamBudget.id));
    const result = await verifyCounters(db, tree.org.id);
    expect(result.ok).toBe(false);
    expect(result.drift).toEqual([
      expect.objectContaining({ budgetId: tree.teamBudget.id, expected: { held: usd('1'), spent: 0n } }),
    ]);
  });

  it('keeps the journal append-only for every role, including the owner (O5)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('1')));
    await expectDbError(db.execute(sql`update ledger_entries set amount = 0`), /append-only/);
    await expectDbError(db.execute(sql`delete from ledger_entries`), /append-only/);
    await expectDbError(db.execute(sql`truncate ledger_entries cascade`), /append-only/);
  });

  it('gives the app role no way to delete budgets or rewrite the journal (L10)', async () => {
    const { db } = handle;
    const tree = await seedTree(db);
    const client = await handle.pool.connect();
    try {
      await client.query('set role aperture_app');
      await client.query('select 1 from budgets limit 1');
      await expectDbError(
        client.query('delete from budgets where id = $1', [tree.agentBudget.id]),
        /permission denied/,
      );
      await expectDbError(client.query('update ledger_entries set amount = 0'), /permission denied/);
      await expectDbError(client.query('delete from audit_events'), /permission denied/);
    } finally {
      await client.query('reset role');
      client.release();
    }
    // Budgets referenced by usage can't be removed even by the owner.
    await reserveOk(db, reserveInput(tree.org.id, tree.agent.id, usd('1')));
    await expectDbError(db.delete(budgets).where(eq(budgets.id, tree.agentBudget.id)), /foreign key/);
  });
});
