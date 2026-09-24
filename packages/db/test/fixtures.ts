import { parseUsd, type Period, type Rail } from '@aperture/core';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../src/client';
import { createBudget, createOrg, createPrincipal } from '../src/entities';
import { reserve, type ReserveInput } from '../src/ledger';
import { budgetUsage, holds } from '../src/schema';

export const usd = (value: string) => parseUsd(value);

let keyCounter = 0;
export const nextKey = (prefix = 'k') => `${prefix}-${String((keyCounter += 1))}-${String(Date.now())}`;

/** Org (monthly) → team (monthly) → agent (daily): the three-level tree most tests use. */
export async function seedTree(
  db: Database,
  limits: { org?: string; team?: string; agent?: string; agentPeriod?: Period; timezone?: string } = {},
) {
  const org = await createOrg(db, { name: 'Test Org', timezone: limits.timezone ?? 'Asia/Dubai' });
  const agent = await createPrincipal(db, { orgId: org.id, kind: 'agent', name: 'research-bot' });
  const orgBudget = await createBudget(db, {
    orgId: org.id,
    name: 'Org',
    scope: 'org',
    scopeId: org.id,
    period: 'month',
    limit: usd(limits.org ?? '100'),
  });
  const teamBudget = await createBudget(db, {
    orgId: org.id,
    parentId: orgBudget.id,
    name: 'Marketing',
    scope: 'team',
    period: 'month',
    limit: usd(limits.team ?? '60'),
  });
  const agentBudget = await createBudget(db, {
    orgId: org.id,
    parentId: teamBudget.id,
    name: 'research-bot daily',
    scope: 'principal',
    scopeId: agent.id,
    period: limits.agentPeriod ?? 'day',
    limit: usd(limits.agent ?? '50'),
  });
  return { org, agent, orgBudget, teamBudget, agentBudget };
}

export const reserveInput = (
  orgId: string,
  principalId: string,
  amount: bigint,
  overrides: Partial<ReserveInput> = {},
): ReserveInput => ({
  orgId,
  principalId,
  rail: 'gateway' satisfies Rail,
  amount,
  idempotencyKey: nextKey('reserve'),
  ttlSeconds: 600,
  onExpiry: 'release',
  ...overrides,
});

export async function reserveOk(db: Database, input: ReserveInput) {
  const result = await reserve(db, input);
  if (!result.ok) throw new Error(`expected reserve to succeed, got ${result.reason}`);
  return result.hold;
}

/** Current usage per budget id (summed over periods). */
export async function usageOf(db: Database, budgetId: string) {
  const rows = await db.select().from(budgetUsage).where(eq(budgetUsage.budgetId, budgetId));
  return rows.reduce((total, row) => ({ held: total.held + row.held, spent: total.spent + row.spent }), {
    held: 0n,
    spent: 0n,
  });
}

/** Makes every open hold of an org already expired, so expiry can be tested without waiting. */
export async function expireAllHolds(db: Database, orgId: string) {
  await db
    .update(holds)
    .set({ expiresAt: sql`now() - interval '1 second'` })
    .where(eq(holds.orgId, orgId));
}

/** Postgres error text, unwrapping drizzle's "Failed query" wrapper. */
export function dbError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(' | ');
}

export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (pattern.test(dbError(error))) return;
    throw new Error(`expected a database error matching ${String(pattern)}, got: ${dbError(error)}`, { cause: error });
  }
  throw new Error(`expected a database error matching ${String(pattern)}, but the query succeeded`);
}
