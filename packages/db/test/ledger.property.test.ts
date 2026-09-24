import fc from 'fast-check';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, DatabaseHandle } from '../src/client';
import { createBudget, createOrg, createPrincipal } from '../src/entities';
import {
  expireHolds,
  recordSpend,
  release,
  reserve,
  settle,
  verifyCounters,
  type Hold,
  type ReserveInput,
} from '../src/ledger';
import { budgetUsage, budgets, holds, ledgerEntries, type principals } from '../src/schema';

type Principal = typeof principals.$inferSelect;
import { createTestDatabase } from './database';
import { dbError, expireAllHolds, nextKey, reserveInput } from './fixtures';

/** CI runs the default; the nightly workflow sets PROPERTY_RUNS higher (plan/testing). */
const RUNS = Number(process.env.PROPERTY_RUNS ?? '15');

let handle: DatabaseHandle;
beforeAll(async () => {
  handle = await createTestDatabase({ maxConnections: 40 });
});
afterAll(async () => {
  await handle.close();
});

// ---------------------------------------------------------------------------------------------
// Scenario generators

const periodArb = fc.constantFrom('day' as const, 'week' as const, 'month' as const, 'none' as const);
const limitArb = fc.bigInt({ min: 0n, max: 40_000_000n });

const treeArb = fc.record({
  rootLimit: limitArb,
  rootMode: fc.constantFrom('hard' as const, 'soft' as const),
  teams: fc.array(fc.record({ limit: limitArb, period: periodArb }), { minLength: 1, maxLength: 3 }),
  agents: fc.array(
    fc.record({
      team: fc.nat(),
      limit: limitArb,
      period: periodArb,
      velocity: fc.option(fc.bigInt({ min: 0n, max: 8n }), { nil: undefined }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
});
type TreeSpec = typeof treeArb extends fc.Arbitrary<infer T> ? T : never;

const reserveOpArb = fc.record({
  agent: fc.nat(),
  amount: fc.bigInt({ min: 1n, max: 12_000_000n }),
  /** Re-send the same request (same idempotency key) concurrently, like a client retry. */
  duplicate: fc.boolean(),
});

const outcomeArb = fc.oneof(
  fc.record({ kind: fc.constant('settle' as const), percent: fc.bigInt({ min: 0n, max: 100n }) }),
  fc.record({ kind: fc.constant('release' as const) }),
  fc.record({ kind: fc.constant('leave' as const) }),
);

const scenarioArb = fc.record({
  tree: treeArb,
  firstWave: fc.array(reserveOpArb, { minLength: 1, maxLength: 30 }),
  outcomes: fc.array(outcomeArb, { minLength: 30, maxLength: 30 }),
  secondWave: fc.array(reserveOpArb, { maxLength: 15 }),
});

async function buildTree(db: Database, spec: TreeSpec) {
  const org = await createOrg(db, { name: 'prop', timezone: 'Asia/Dubai' });
  const root = await createBudget(db, {
    orgId: org.id,
    name: 'root',
    scope: 'org',
    scopeId: org.id,
    period: 'month',
    limit: spec.rootLimit,
    mode: spec.rootMode,
  });
  const teams = [];
  for (const [index, team] of spec.teams.entries()) {
    teams.push(
      await createBudget(db, {
        orgId: org.id,
        parentId: root.id,
        name: `team-${String(index)}`,
        scope: 'team',
        period: team.period,
        limit: team.limit,
      }),
    );
  }
  const agents: Principal[] = [];
  for (const [index, agent] of spec.agents.entries()) {
    const principal = await createPrincipal(db, { orgId: org.id, kind: 'agent', name: `agent-${String(index)}` });
    const team = teams[agent.team % teams.length];
    await createBudget(db, {
      orgId: org.id,
      parentId: team?.id,
      name: `agent-${String(index)}`,
      scope: 'principal',
      scopeId: principal.id,
      period: agent.period,
      limit: agent.limit,
    });
    if (agent.velocity !== undefined) {
      await createBudget(db, {
        orgId: org.id,
        name: `agent-${String(index)}-velocity`,
        scope: 'principal',
        scopeId: principal.id,
        unit: 'count',
        period: 'hour',
        limit: agent.velocity,
      });
    }
    agents.push(principal);
  }
  return { org, agents };
}

// ---------------------------------------------------------------------------------------------
// Invariant checks

/** INV-1: no hard budget has held + spent above its limit, in any period. */
async function assertHardBudgetsRespected(db: Database, orgId: string) {
  const rows = await db
    .select({
      name: budgets.name,
      limit: budgets.limitAmount,
      held: budgetUsage.held,
      spent: budgetUsage.spent,
      periodKey: budgetUsage.periodKey,
    })
    .from(budgetUsage)
    .innerJoin(budgets, eq(budgets.id, budgetUsage.budgetId))
    .where(and(eq(budgets.orgId, orgId), eq(budgets.mode, 'hard')));
  for (const row of rows) {
    if (row.held + row.spent > row.limit) {
      throw new Error(
        `INV-1 violated on ${row.name} ${row.periodKey}: ${String(row.held + row.spent)} > ${String(row.limit)}`,
      );
    }
  }
}

async function snapshot(db: Database, orgId: string) {
  const usage = await db
    .select({
      budgetId: budgetUsage.budgetId,
      periodKey: budgetUsage.periodKey,
      held: budgetUsage.held,
      spent: budgetUsage.spent,
    })
    .from(budgetUsage)
    .innerJoin(budgets, eq(budgets.id, budgetUsage.budgetId))
    .where(eq(budgets.orgId, orgId))
    .orderBy(budgetUsage.budgetId, budgetUsage.periodKey);
  const [entries] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.orgId, orgId));
  const [holdCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(holds)
    .where(eq(holds.orgId, orgId));
  return { usage, entries: entries?.n, holds: holdCount?.n };
}

const toReserve = (
  orgId: string,
  agents: { id: string }[],
  op: { agent: number; amount: bigint },
  key: string,
): ReserveInput =>
  reserveInput(orgId, agents[op.agent % agents.length]?.id ?? '', op.amount, {
    idempotencyKey: key,
    onExpiry: 'settle',
  });

describe('ledger invariants under concurrency', () => {
  it('INV-1…4 hold for random trees and random concurrent operations', async () => {
    const { db } = handle;
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const { org, agents } = await buildTree(db, scenario.tree);

        // Wave 1: concurrent reserves, some sent twice with the same key.
        const firstInputs = scenario.firstWave.map((op) => ({
          op,
          input: toReserve(org.id, agents, op, nextKey('p1')),
        }));
        const wave = firstInputs.flatMap(({ op, input }) => (op.duplicate ? [input, input] : [input]));
        const firstResults = await Promise.all(wave.map((input) => reserve(db, input)));
        await assertHardBudgetsRespected(db, org.id);

        // Retries of the same key must converge on one hold.
        const byKey = new Map<string, Set<string>>();
        wave.forEach((input, index) => {
          const result = firstResults[index];
          if (result?.ok)
            byKey.set(input.idempotencyKey, (byKey.get(input.idempotencyKey) ?? new Set()).add(result.hold.id));
        });
        for (const ids of byKey.values()) expect(ids.size).toBe(1);

        const heldHolds = [
          ...new Map(firstResults.flatMap((r) => (r.ok ? [[r.hold.id, r.hold] as const] : []))).values(),
        ];

        // Wave 2: settle/release concurrently with a second batch of reserves.
        const settleCalls = heldHolds.flatMap((hold: Hold, index) => {
          const outcome = scenario.outcomes[index % scenario.outcomes.length] ?? { kind: 'leave' as const };
          if (outcome.kind === 'settle') {
            return [
              settle(db, { orgId: org.id, holdId: hold.id, actualAmount: (hold.amount * outcome.percent) / 100n }),
            ];
          }
          if (outcome.kind === 'release') return [release(db, { orgId: org.id, holdId: hold.id })];
          return [];
        });
        const secondInputs = scenario.secondWave.map((op) => toReserve(org.id, agents, op, nextKey('p2')));
        const [, secondResults] = await Promise.all([
          Promise.all(settleCalls),
          Promise.all(secondInputs.map((input) => reserve(db, input))),
        ]);
        await assertHardBudgetsRespected(db, org.id);

        // Everything still open expires (settled at the hold amount, which is ≤ the hold).
        await expireAllHolds(db, org.id);
        await expireHolds(db, { orgId: org.id });

        // INV-3: every hold is terminal.
        const open = await db
          .select({ id: holds.id })
          .from(holds)
          .where(and(eq(holds.orgId, org.id), eq(holds.status, 'open')));
        expect(open).toEqual([]);
        await assertHardBudgetsRespected(db, org.id);

        // INV-2: counters equal the fold of the journal.
        const counters = await verifyCounters(db, org.id);
        expect(counters.drift).toEqual([]);

        // INV-4: replaying every successful operation changes nothing.
        const before = await snapshot(db, org.id);
        const succeeded = [
          ...wave.filter((_, index) => firstResults[index]?.ok),
          ...secondInputs.filter((_, index) => secondResults[index]?.ok),
        ];
        for (const input of succeeded) {
          const again = await reserve(db, input);
          expect(again.ok && again.replayed).toBe(true);
        }
        const settledHolds = await db
          .select()
          .from(holds)
          .where(and(eq(holds.orgId, org.id), eq(holds.status, 'settled')));
        for (const hold of settledHolds) {
          expect(
            (await settle(db, { orgId: org.id, holdId: hold.id, actualAmount: hold.settledAmount ?? 0n })).replayed,
          ).toBe(true);
        }
        const releasedHolds = await db
          .select()
          .from(holds)
          .where(and(eq(holds.orgId, org.id), eq(holds.status, 'released')));
        for (const hold of releasedHolds) {
          expect((await release(db, { orgId: org.id, holdId: hold.id })).replayed).toBe(true);
        }
        expect(await snapshot(db, org.id)).toEqual(before);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('exactness and throughput', () => {
  it('200 concurrent reserves against one budget approve exactly as many as fit', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'contention' });
    const agent = await createPrincipal(db, { orgId: org.id, kind: 'agent', name: 'hot' });
    await createBudget(db, {
      orgId: org.id,
      name: 'hot',
      scope: 'principal',
      scopeId: agent.id,
      period: 'day',
      limit: 50_000_000n,
    });

    const durations: number[] = [];
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 200 }, async () => {
        const t0 = performance.now();
        const result = await reserve(db, reserveInput(org.id, agent.id, 1_000_000n));
        durations.push(performance.now() - t0);
        return result;
      }),
    );
    const total = performance.now() - started;

    expect(results.filter((result) => result.ok)).toHaveLength(50);
    expect(results.filter((result) => !result.ok && result.reason === 'budget_exceeded')).toHaveLength(150);
    await assertHardBudgetsRespected(db, org.id);

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
    const p99 = durations[Math.floor(durations.length * 0.99)] ?? 0;
    // Recorded for plan/testing's performance baseline; includes waiting for the row lock.
    console.info(
      `[bench] 200 concurrent reserves on one budget: total ${total.toFixed(0)} ms, ` +
        `${(total / 200).toFixed(2)} ms/reserve serialized, latency p50 ${p50.toFixed(0)} ms, p99 ${p99.toFixed(0)} ms`,
    );
    expect(total).toBeLessThan(20_000);
  });
});

describe('deadlock hunt (L2)', () => {
  it('thousands of mixed operations over overlapping budget paths never deadlock', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'deadlock-hunt' });
    const root = await createBudget(db, {
      orgId: org.id,
      name: 'root',
      scope: 'org',
      scopeId: org.id,
      period: 'month',
      limit: 10n ** 15n,
    });
    const teamA = await createBudget(db, {
      orgId: org.id,
      parentId: root.id,
      name: 'A',
      scope: 'team',
      period: 'month',
      limit: 10n ** 14n,
    });
    const teamB = await createBudget(db, {
      orgId: org.id,
      parentId: root.id,
      name: 'B',
      scope: 'team',
      period: 'day',
      limit: 10n ** 14n,
    });
    const agents: Principal[] = [];
    for (let i = 0; i < 6; i += 1) {
      const agent = await createPrincipal(db, { orgId: org.id, kind: 'agent', name: `agent-${String(i)}` });
      await createBudget(db, {
        orgId: org.id,
        parentId: i % 2 === 0 ? teamA.id : teamB.id,
        name: `agent-${String(i)}`,
        scope: 'principal',
        scopeId: agent.id,
        period: 'day',
        limit: 10n ** 13n,
      });
      agents.push(agent);
    }
    // Mandate budgets that hang off the *other* team, so paths cross in both directions.
    const mandates = await Promise.all([
      createBudget(db, {
        orgId: org.id,
        parentId: teamB.id,
        name: 'mandate-x',
        scope: 'mandate',
        period: 'none',
        limit: 10n ** 13n,
      }),
      createBudget(db, {
        orgId: org.id,
        parentId: teamA.id,
        name: 'mandate-y',
        scope: 'mandate',
        period: 'none',
        limit: 10n ** 13n,
      }),
    ]);

    const errors: string[] = [];
    const openHolds: Hold[] = [];
    const rounds = Number(process.env.DEADLOCK_ROUNDS ?? '20');
    for (let round = 0; round < rounds; round += 1) {
      const ops = Array.from({ length: 64 }, (_, i) => {
        const agent = agents[(round * 7 + i) % agents.length];
        const mandate = mandates[(round + i) % 3];
        const pick = (round * 31 + i * 17) % 10;
        if (pick < 5 || openHolds.length === 0) {
          return reserve(db, {
            ...reserveInput(org.id, agent?.id ?? '', BigInt(1 + ((round * i) % 997))),
            ...(mandate ? { mandateBudgetId: mandate.id } : {}),
          }).then((result) => {
            if (result.ok) openHolds.push(result.hold);
          });
        }
        if (pick < 8) {
          const hold = openHolds.shift();
          if (!hold) return Promise.resolve();
          return pick < 7
            ? settle(db, { orgId: org.id, holdId: hold.id, actualAmount: hold.amount / 2n }).then(() => undefined)
            : release(db, { orgId: org.id, holdId: hold.id }).then(() => undefined);
        }
        return recordSpend(db, {
          orgId: org.id,
          principalId: agent?.id ?? '',
          rail: 'provider',
          kind: 'observed',
          amount: 7n,
          idempotencyKey: nextKey('obs'),
        }).then(() => undefined);
      });
      const settled = await Promise.allSettled(ops);
      for (const outcome of settled) if (outcome.status === 'rejected') errors.push(dbError(outcome.reason));
    }
    expect(errors).toEqual([]);
    expect((await verifyCounters(db, org.id)).drift).toEqual([]);
  });
});
