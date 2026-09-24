import { MAX_ABS_MICROS, periodKey, type Period, type Rail } from '@aperture/core';
import { and, asc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { DbOrTx, Transaction } from './client';
import { budgetUsage, budgets, holds, ledgerEntries, orgs, principals } from './schema';

/*
 * The budget ledger (plan/architecture §7, ADR 0002).
 *
 * Every operation runs in one transaction and locks the budget_usage rows it touches in
 * ascending (budget_id, period_key) order, so concurrent operations can't deadlock and a
 * hard budget can't be overspent by approved holds. Run one ledger operation per
 * transaction: composing several in one outer transaction can break that lock ordering.
 */

export type Hold = typeof holds.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type ExpiryAction = Hold['onExpiry'];

export class LedgerError extends Error {
  readonly code:
    | 'org_not_found'
    | 'principal_not_found'
    | 'invalid_amount'
    | 'hold_not_found'
    | 'hold_not_open'
    | 'idempotency_conflict'
    | 'entry_not_found'
    | 'refund_exceeds_original';

  constructor(code: LedgerError['code'], message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

interface PathBudget {
  id: string;
  name: string;
  unit: 'micros' | 'count';
  period: Period;
  limitAmount: bigint;
  mode: 'hard' | 'soft';
  alertThresholds: number[];
}

interface UsageKey {
  budgetId: string;
  periodKey: string;
}

interface Usage {
  held: bigint;
  spent: bigint;
}

const usageKey = (budgetId: string, key: string) => `${budgetId}|${key}`;
/** Count budgets (velocity limits) move by one per action; money budgets by the amount. */
const delta = (unit: PathBudget['unit'], amount: bigint) => (unit === 'count' ? 1n : amount);

type AmountRule = 'positive' | 'non_negative' | 'non_zero';

function assertAmount(amount: bigint, rule: AmountRule = 'positive') {
  const inRange = amount <= MAX_ABS_MICROS && amount >= -MAX_ABS_MICROS;
  const valid = inRange && (rule === 'positive' ? amount > 0n : rule === 'non_negative' ? amount >= 0n : amount !== 0n);
  if (!valid) throw new LedgerError('invalid_amount', `invalid amount ${amount.toString()} (must be ${rule})`);
}

/**
 * The database clock, truncated to milliseconds (the precision of JS dates, so stored
 * timestamps round-trip exactly). All time decisions use it, never the app server's clock.
 */
export async function dbNow(tx: DbOrTx): Promise<Date> {
  const result = await tx.execute<{ ms: string }>(
    sql`select (extract(epoch from date_trunc('milliseconds', now())) * 1000)::bigint as ms`,
  );
  const ms = Number(result.rows[0]?.ms);
  if (!Number.isFinite(ms)) throw new Error('database did not return a timestamp');
  return new Date(ms);
}

async function orgTimezone(tx: Transaction, orgId: string): Promise<string> {
  const [org] = await tx.select({ timezone: orgs.timezone }).from(orgs).where(eq(orgs.id, orgId));
  if (!org) throw new LedgerError('org_not_found', 'org not found');
  return org.timezone;
}

async function lockIdempotencyKey(tx: Transaction, orgId: string, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${orgId}:${key}`}, 0))`);
}

/** The principal's budgets, every ancestor, and any extra budgets (e.g. a mandate's), for this rail. */
async function resolveBudgetPath(
  tx: Transaction,
  orgId: string,
  principalId: string,
  rail: Rail,
  extraBudgetIds: readonly string[] = [],
): Promise<PathBudget[]> {
  const extra: SQL =
    extraBudgetIds.length > 0
      ? sql` or id in (${sql.join(
          extraBudgetIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
  const result = await tx.execute<{
    id: string;
    name: string;
    unit: PathBudget['unit'];
    period: Period;
    limit_amount: string;
    mode: PathBudget['mode'];
    alert_thresholds: number[];
  }>(sql`
    with recursive path as (
      select id, parent_id from budgets
      where org_id = ${orgId} and ((scope = 'principal' and scope_id = ${principalId}::uuid)${extra})
      union
      select b.id, b.parent_id from budgets b join path p on b.id = p.parent_id
    )
    select b.id, b.name, b.unit, b.period, b.limit_amount, b.mode, b.alert_thresholds
    from budgets b join (select distinct id from path) p on p.id = b.id
    where b.org_id = ${orgId} and b.archived_at is null
      and (cardinality(b.rails) = 0 or ${rail} = any(b.rails))
    order by b.id`);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    unit: row.unit,
    period: row.period,
    limitAmount: BigInt(row.limit_amount),
    mode: row.mode,
    alertThresholds: row.alert_thresholds,
  }));
}

/** Ensures usage rows exist, then locks them in ascending key order. */
async function lockUsage(tx: Transaction, keys: readonly UsageKey[]): Promise<Map<string, Usage>> {
  const usage = new Map<string, Usage>();
  if (keys.length === 0) return usage;
  const sorted = [...keys].sort((a, b) =>
    a.budgetId === b.budgetId ? a.periodKey.localeCompare(b.periodKey) : a.budgetId < b.budgetId ? -1 : 1,
  );
  await tx.insert(budgetUsage).values(sorted).onConflictDoNothing();
  const result = await tx.execute<{ budget_id: string; period_key: string; held: string; spent: string }>(sql`
    select budget_id, period_key, held, spent from budget_usage
    where (budget_id, period_key) in (${sql.join(
      sorted.map((key) => sql`(${key.budgetId}::uuid, ${key.periodKey})`),
      sql`, `,
    )})
    order by budget_id, period_key
    for update`);
  for (const row of result.rows) {
    usage.set(usageKey(row.budget_id, row.period_key), { held: BigInt(row.held), spent: BigInt(row.spent) });
  }
  return usage;
}

async function applyUsage(
  tx: Transaction,
  changes: readonly (UsageKey & { heldDelta: bigint; spentDelta: bigint })[],
): Promise<void> {
  const effective = changes.filter((change) => change.heldDelta !== 0n || change.spentDelta !== 0n);
  if (effective.length === 0) return;
  await tx.execute(sql`
    update budget_usage u
    set held = u.held + v.held_delta, spent = u.spent + v.spent_delta, updated_at = now()
    from (values ${sql.join(
      effective.map(
        (change) =>
          sql`(${change.budgetId}::uuid, ${change.periodKey}, ${change.heldDelta.toString()}::bigint, ${change.spentDelta.toString()}::bigint)`,
      ),
      sql`, `,
    )}) as v(budget_id, period_key, held_delta, spent_delta)
    where u.budget_id = v.budget_id and u.period_key = v.period_key`);
}

async function budgetUnits(tx: Transaction, budgetIds: readonly string[]): Promise<Map<string, PathBudget['unit']>> {
  if (budgetIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: budgets.id, unit: budgets.unit })
    .from(budgets)
    .where(inArray(budgets.id, [...budgetIds]));
  return new Map(rows.map((row) => [row.id, row.unit]));
}

const unitOf = (units: Map<string, PathBudget['unit']>, budgetId: string) => {
  const unit = units.get(budgetId);
  if (unit === undefined) throw new Error(`budget ${budgetId} disappeared`);
  return unit;
};

// ---------------------------------------------------------------------------------------------
// reserve

export interface ReserveInput {
  orgId: string;
  principalId: string;
  rail: Rail;
  /** Estimated cost in µUSD; must be positive. */
  amount: bigint;
  idempotencyKey: string;
  /** How long the hold may stay open before `expireHolds` applies `onExpiry`. */
  ttlSeconds: number;
  onExpiry: ExpiryAction;
  /** Extra budgets to enforce, e.g. the budget of the mandate the principal acts under. */
  mandateBudgetId?: string;
  resource?: string;
  externalRef?: string;
  meta?: Record<string, unknown>;
}

export interface BudgetBreach {
  budgetId: string;
  budgetName: string;
  limit: bigint;
  /** held + spent before this action. */
  used: bigint;
  remaining: bigint;
}

export interface ThresholdCrossing {
  budgetId: string;
  budgetName: string;
  thresholdPercent: number;
}

export type ReserveResult =
  | { ok: true; hold: Hold; replayed: boolean; thresholdCrossings: ThresholdCrossing[] }
  | ({ ok: false; reason: 'budget_exceeded' } & BudgetBreach)
  | { ok: false; reason: 'no_budget' | 'principal_inactive' };

/**
 * Reserves an estimated amount against the principal's budget path. Fails closed: a principal
 * with no budget, or a paused/revoked principal, can't reserve. Idempotent per key.
 */
export async function reserve(db: DbOrTx, input: ReserveInput): Promise<ReserveResult> {
  assertAmount(input.amount);
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0)
    throw new RangeError('ttlSeconds must be a positive integer');

  return db.transaction(async (tx) => {
    await lockIdempotencyKey(tx, input.orgId, input.idempotencyKey);
    const [existing] = await tx
      .select()
      .from(holds)
      .where(and(eq(holds.orgId, input.orgId), eq(holds.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (
        existing.principalId !== input.principalId ||
        existing.rail !== input.rail ||
        existing.amount !== input.amount
      ) {
        throw new LedgerError('idempotency_conflict', 'idempotency key reused for a different reservation');
      }
      return { ok: true, hold: existing, replayed: true, thresholdCrossings: [] };
    }

    const [principal] = await tx
      .select({ status: principals.status })
      .from(principals)
      .where(and(eq(principals.id, input.principalId), eq(principals.orgId, input.orgId)));
    if (!principal) throw new LedgerError('principal_not_found', 'principal not found');
    if (principal.status !== 'active') return { ok: false, reason: 'principal_inactive' };

    const now = await dbNow(tx);
    const timezone = await orgTimezone(tx, input.orgId);
    const path = await resolveBudgetPath(
      tx,
      input.orgId,
      input.principalId,
      input.rail,
      input.mandateBudgetId === undefined ? [] : [input.mandateBudgetId],
    );
    if (path.length === 0) return { ok: false, reason: 'no_budget' };

    const keys = path.map((budget) => ({ budgetId: budget.id, periodKey: periodKey(now, budget.period, timezone) }));
    const usage = await lockUsage(tx, keys);

    const crossings: ThresholdCrossing[] = [];
    for (const [index, budget] of path.entries()) {
      const key = keys[index];
      const current = key ? usage.get(usageKey(key.budgetId, key.periodKey)) : undefined;
      if (!current) throw new Error('usage row missing after lock');
      const used = current.held + current.spent;
      const next = used + delta(budget.unit, input.amount);
      if (budget.mode === 'hard' && next > budget.limitAmount) {
        const remaining = budget.limitAmount - used;
        return {
          ok: false,
          reason: 'budget_exceeded',
          budgetId: budget.id,
          budgetName: budget.name,
          limit: budget.limitAmount,
          used,
          remaining: remaining > 0n ? remaining : 0n,
        };
      }
      for (const threshold of budget.alertThresholds) {
        const line = budget.limitAmount * BigInt(threshold);
        if (used * 100n < line && next * 100n >= line) {
          crossings.push({ budgetId: budget.id, budgetName: budget.name, thresholdPercent: threshold });
        }
      }
    }

    const holdId = uuidv7();
    const budgetIds = keys.map((key) => key.budgetId);
    const periodKeys = keys.map((key) => key.periodKey);
    const [hold] = await tx
      .insert(holds)
      .values({
        id: holdId,
        orgId: input.orgId,
        principalId: input.principalId,
        rail: input.rail,
        amount: input.amount,
        onExpiry: input.onExpiry,
        idempotencyKey: input.idempotencyKey,
        resource: input.resource,
        externalRef: input.externalRef,
        budgetIds,
        periodKeys,
        expiresAt: new Date(now.getTime() + input.ttlSeconds * 1_000),
      })
      .returning();
    if (!hold) throw new Error('insert returned no row');

    await tx.insert(ledgerEntries).values({
      id: uuidv7(),
      orgId: input.orgId,
      kind: 'hold',
      amount: input.amount,
      holdId,
      rail: input.rail,
      principalId: input.principalId,
      resource: input.resource,
      externalRef: input.externalRef,
      budgetIds,
      periodKeys,
      idempotencyKey: `hold:${holdId}`,
      occurredAt: now,
      meta: input.meta ?? {},
    });
    await applyUsage(
      tx,
      path.map((budget, index) => ({
        budgetId: budget.id,
        periodKey: periodKeys[index] ?? '',
        heldDelta: delta(budget.unit, input.amount),
        spentDelta: 0n,
      })),
    );
    return { ok: true, hold, replayed: false, thresholdCrossings: crossings };
  });
}

// ---------------------------------------------------------------------------------------------
// settle / release / expiry

async function lockHold(tx: Transaction, orgId: string, holdId: string): Promise<Hold> {
  const [hold] = await tx
    .select()
    .from(holds)
    .where(and(eq(holds.id, holdId), eq(holds.orgId, orgId)))
    .for('update');
  if (!hold) throw new LedgerError('hold_not_found', 'hold not found');
  return hold;
}

const isOpen = (hold: Hold) => hold.status === 'open' || hold.status === 'expired_reconciling';

async function settleLocked(tx: Transaction, hold: Hold, actual: bigint, now: Date, meta: Record<string, unknown>) {
  const units = await budgetUnits(tx, hold.budgetIds);
  const keys = hold.budgetIds.map((budgetId, index) => ({ budgetId, periodKey: hold.periodKeys[index] ?? '' }));
  await lockUsage(tx, keys);
  await applyUsage(
    tx,
    keys.map((key) => {
      const unit = unitOf(units, key.budgetId);
      return { ...key, heldDelta: -delta(unit, hold.amount), spentDelta: delta(unit, actual) };
    }),
  );
  const overage = actual > hold.amount;
  await tx.update(holds).set({ status: 'settled', settledAt: now, settledAmount: actual }).where(eq(holds.id, hold.id));
  await tx.insert(ledgerEntries).values({
    id: uuidv7(),
    orgId: hold.orgId,
    kind: 'capture',
    amount: actual,
    holdId: hold.id,
    rail: hold.rail,
    principalId: hold.principalId,
    resource: hold.resource,
    externalRef: hold.externalRef,
    budgetIds: hold.budgetIds,
    periodKeys: hold.periodKeys,
    idempotencyKey: `capture:${hold.id}`,
    occurredAt: now,
    meta: { ...meta, holdAmount: hold.amount.toString(), overage },
  });
  return { overage };
}

async function releaseLocked(tx: Transaction, hold: Hold, now: Date) {
  const units = await budgetUnits(tx, hold.budgetIds);
  const keys = hold.budgetIds.map((budgetId, index) => ({ budgetId, periodKey: hold.periodKeys[index] ?? '' }));
  await lockUsage(tx, keys);
  await applyUsage(
    tx,
    keys.map((key) => ({ ...key, heldDelta: -delta(unitOf(units, key.budgetId), hold.amount), spentDelta: 0n })),
  );
  await tx.update(holds).set({ status: 'released', settledAt: now }).where(eq(holds.id, hold.id));
  await tx.insert(ledgerEntries).values({
    id: uuidv7(),
    orgId: hold.orgId,
    kind: 'release',
    amount: hold.amount,
    holdId: hold.id,
    rail: hold.rail,
    principalId: hold.principalId,
    resource: hold.resource,
    externalRef: hold.externalRef,
    budgetIds: hold.budgetIds,
    periodKeys: hold.periodKeys,
    idempotencyKey: `release:${hold.id}`,
    occurredAt: now,
  });
}

export interface SettleInput {
  orgId: string;
  holdId: string;
  /** Actual cost in µUSD; may be zero, may exceed the hold (an overage, flagged). */
  actualAmount: bigint;
  meta?: Record<string, unknown>;
}

/**
 * Converts a hold into spend in the periods it was reserved in (L7), even if it settles after
 * the period ended. Settling an already-settled hold with the same amount is a no-op.
 */
export async function settle(db: DbOrTx, input: SettleInput): Promise<{ overage: boolean; replayed: boolean }> {
  assertAmount(input.actualAmount, 'non_negative');
  return db.transaction(async (tx) => {
    const hold = await lockHold(tx, input.orgId, input.holdId);
    if (hold.status === 'settled') {
      if (hold.settledAmount === input.actualAmount)
        return { overage: input.actualAmount > hold.amount, replayed: true };
      throw new LedgerError('hold_not_open', 'hold was already settled with a different amount');
    }
    if (!isOpen(hold)) throw new LedgerError('hold_not_open', `hold is ${hold.status}`);
    const { overage } = await settleLocked(tx, hold, input.actualAmount, await dbNow(tx), input.meta ?? {});
    return { overage, replayed: false };
  });
}

/** Returns a hold's amount to its budgets (the action failed or was cancelled). Idempotent. */
export async function release(db: DbOrTx, input: { orgId: string; holdId: string }): Promise<{ replayed: boolean }> {
  return db.transaction(async (tx) => {
    const hold = await lockHold(tx, input.orgId, input.holdId);
    if (hold.status === 'released') return { replayed: true };
    if (!isOpen(hold)) throw new LedgerError('hold_not_open', `hold is ${hold.status}`);
    await releaseLocked(tx, hold, await dbNow(tx));
    return { replayed: false };
  });
}

export interface ExpiryResult {
  settled: number;
  released: number;
  reconciling: number;
}

/**
 * Applies each expired hold's `onExpiry` action: settle at the hold amount (gateway text),
 * release (x402, cards), or mark `expired_reconciling` and keep the money held until a worker
 * learns the real outcome (media jobs). One transaction per hold keeps lock ordering intact.
 */
export async function expireHolds(
  db: DbOrTx,
  options: { orgId?: string; batchSize?: number } = {},
): Promise<ExpiryResult> {
  const result: ExpiryResult = { settled: 0, released: 0, reconciling: 0 };
  const candidates = await db
    .select({ id: holds.id, orgId: holds.orgId })
    .from(holds)
    .where(
      and(
        eq(holds.status, 'open'),
        lte(holds.expiresAt, sql`now()`),
        options.orgId === undefined ? undefined : eq(holds.orgId, options.orgId),
      ),
    )
    .orderBy(asc(holds.expiresAt))
    .limit(options.batchSize ?? 500);

  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const [hold] = await tx
        .select()
        .from(holds)
        .where(and(eq(holds.id, candidate.id), eq(holds.status, 'open'), lte(holds.expiresAt, sql`now()`)))
        .for('update', { skipLocked: true });
      if (!hold) return;
      const now = await dbNow(tx);
      if (hold.onExpiry === 'settle') {
        await settleLocked(tx, hold, hold.amount, now, { expired: true });
        result.settled += 1;
      } else if (hold.onExpiry === 'release') {
        await releaseLocked(tx, hold, now);
        result.released += 1;
      } else {
        await tx.update(holds).set({ status: 'expired_reconciling' }).where(eq(holds.id, hold.id));
        result.reconciling += 1;
      }
    });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// spend without a hold, refunds, adjustments

export interface RecordSpendInput {
  orgId: string;
  principalId: string;
  rail: Rail;
  /** `unheld_capture`: money moved without our authorization (card force capture, late capture).
   *  `observed`: provider usage imported by a connector. */
  kind: 'unheld_capture' | 'observed';
  amount: bigint;
  idempotencyKey: string;
  /** When the spend happened; decides which period it counts in. Defaults to now. */
  occurredAt?: Date;
  resource?: string;
  externalRef?: string;
  meta?: Record<string, unknown>;
}

export interface RecordSpendResult {
  entry: LedgerEntry;
  replayed: boolean;
  /** Hard budgets that are now over their limit; the caller revokes or freezes and alerts. */
  overBudget: BudgetBreach[];
}

/** Records spend that already happened. Always succeeds — the money has moved. */
export async function recordSpend(db: DbOrTx, input: RecordSpendInput): Promise<RecordSpendResult> {
  assertAmount(input.amount);
  return db.transaction(async (tx) => {
    await lockIdempotencyKey(tx, input.orgId, input.idempotencyKey);
    const [existing] = await tx
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.orgId, input.orgId), eq(ledgerEntries.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (
        existing.amount !== input.amount ||
        existing.principalId !== input.principalId ||
        existing.kind !== input.kind
      ) {
        throw new LedgerError('idempotency_conflict', 'idempotency key reused for a different entry');
      }
      return { entry: existing, replayed: true, overBudget: [] };
    }

    const now = await dbNow(tx);
    const occurredAt = input.occurredAt ?? now;
    const timezone = await orgTimezone(tx, input.orgId);
    const path = await resolveBudgetPath(tx, input.orgId, input.principalId, input.rail);
    const keys = path.map((budget) => ({
      budgetId: budget.id,
      periodKey: periodKey(occurredAt, budget.period, timezone),
    }));
    const usage = await lockUsage(tx, keys);

    const overBudget: BudgetBreach[] = [];
    for (const [index, budget] of path.entries()) {
      const key = keys[index];
      const current = key ? usage.get(usageKey(key.budgetId, key.periodKey)) : undefined;
      if (!current) throw new Error('usage row missing after lock');
      const used = current.held + current.spent;
      const next = used + delta(budget.unit, input.amount);
      if (budget.mode === 'hard' && next > budget.limitAmount) {
        overBudget.push({
          budgetId: budget.id,
          budgetName: budget.name,
          limit: budget.limitAmount,
          used,
          remaining: 0n,
        });
      }
    }

    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        id: uuidv7(),
        orgId: input.orgId,
        kind: input.kind,
        amount: input.amount,
        rail: input.rail,
        principalId: input.principalId,
        resource: input.resource,
        externalRef: input.externalRef,
        budgetIds: keys.map((key) => key.budgetId),
        periodKeys: keys.map((key) => key.periodKey),
        idempotencyKey: input.idempotencyKey,
        occurredAt,
        meta: input.meta ?? {},
      })
      .returning();
    if (!entry) throw new Error('insert returned no row');
    await applyUsage(
      tx,
      path.map((budget, index) => ({
        budgetId: budget.id,
        periodKey: keys[index]?.periodKey ?? '',
        heldDelta: 0n,
        spentDelta: delta(budget.unit, input.amount),
      })),
    );
    return { entry, replayed: false, overBudget };
  });
}

/**
 * Credits a refund of an earlier spend entry. The credit lands in the *current* period of each
 * budget the original charge touched (L13): if the original period is still current that is the
 * same period; if it has closed, reopening it would change history, so the current one gets it.
 * Money budgets only; action counts are not refunded. Refunds can't exceed the original.
 */
export async function refund(
  db: DbOrTx,
  input: {
    orgId: string;
    originalEntryId: string;
    amount: bigint;
    idempotencyKey: string;
    meta?: Record<string, unknown>;
  },
): Promise<{ entry: LedgerEntry; replayed: boolean }> {
  assertAmount(input.amount);
  return db.transaction(async (tx) => {
    await lockIdempotencyKey(tx, input.orgId, `refund-of:${input.originalEntryId}`);
    const [existing] = await tx
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.orgId, input.orgId), eq(ledgerEntries.idempotencyKey, input.idempotencyKey)));
    if (existing) return { entry: existing, replayed: true };

    const [original] = await tx
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.id, input.originalEntryId), eq(ledgerEntries.orgId, input.orgId)));
    if (!original || !['capture', 'unheld_capture', 'observed'].includes(original.kind)) {
      throw new LedgerError('entry_not_found', 'original spend entry not found');
    }
    const refunded = await tx.execute<{ total: string | null }>(sql`
      select sum(amount) as total from ledger_entries
      where org_id = ${input.orgId} and kind = 'refund' and meta->>'originalEntryId' = ${input.originalEntryId}`);
    const alreadyRefunded = BigInt(refunded.rows[0]?.total ?? '0');
    if (alreadyRefunded + input.amount > original.amount) {
      throw new LedgerError('refund_exceeds_original', 'refunds would exceed the original amount');
    }

    const now = await dbNow(tx);
    const timezone = await orgTimezone(tx, input.orgId);
    const rows =
      original.budgetIds.length === 0
        ? []
        : await tx
            .select({ id: budgets.id, unit: budgets.unit, period: budgets.period })
            .from(budgets)
            .where(inArray(budgets.id, original.budgetIds));
    const moneyBudgets = rows.filter((row) => row.unit === 'micros');
    const keys = moneyBudgets.map((budget) => ({
      budgetId: budget.id,
      periodKey: periodKey(now, budget.period, timezone),
    }));
    await lockUsage(tx, keys);

    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        id: uuidv7(),
        orgId: input.orgId,
        kind: 'refund',
        amount: input.amount,
        holdId: original.holdId,
        rail: original.rail,
        principalId: original.principalId,
        resource: original.resource,
        externalRef: original.externalRef,
        budgetIds: keys.map((key) => key.budgetId),
        periodKeys: keys.map((key) => key.periodKey),
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
        meta: { ...input.meta, originalEntryId: input.originalEntryId },
      })
      .returning();
    if (!entry) throw new Error('insert returned no row');
    await applyUsage(
      tx,
      keys.map((key) => ({ ...key, heldDelta: 0n, spentDelta: -input.amount })),
    );
    return { entry, replayed: false };
  });
}

/**
 * Signed correction to a principal's money spend in the current period, e.g. when a provider's
 * daily cost report differs from what per-minute usage implied (C4). Never touches action counts.
 */
export async function adjust(
  db: DbOrTx,
  input: {
    orgId: string;
    principalId: string;
    rail: Rail;
    amount: bigint;
    idempotencyKey: string;
    occurredAt?: Date;
    meta?: Record<string, unknown>;
  },
): Promise<{ entry: LedgerEntry; replayed: boolean }> {
  assertAmount(input.amount, 'non_zero');
  return db.transaction(async (tx) => {
    await lockIdempotencyKey(tx, input.orgId, input.idempotencyKey);
    const [existing] = await tx
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.orgId, input.orgId), eq(ledgerEntries.idempotencyKey, input.idempotencyKey)));
    if (existing) return { entry: existing, replayed: true };

    const now = await dbNow(tx);
    const occurredAt = input.occurredAt ?? now;
    const timezone = await orgTimezone(tx, input.orgId);
    const path = (await resolveBudgetPath(tx, input.orgId, input.principalId, input.rail)).filter(
      (budget) => budget.unit === 'micros',
    );
    const keys = path.map((budget) => ({
      budgetId: budget.id,
      periodKey: periodKey(occurredAt, budget.period, timezone),
    }));
    await lockUsage(tx, keys);
    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        id: uuidv7(),
        orgId: input.orgId,
        kind: 'adjustment',
        amount: input.amount,
        rail: input.rail,
        principalId: input.principalId,
        budgetIds: keys.map((key) => key.budgetId),
        periodKeys: keys.map((key) => key.periodKey),
        idempotencyKey: input.idempotencyKey,
        occurredAt,
        meta: input.meta ?? {},
      })
      .returning();
    if (!entry) throw new Error('insert returned no row');
    await applyUsage(
      tx,
      keys.map((key) => ({ ...key, heldDelta: 0n, spentDelta: input.amount })),
    );
    return { entry, replayed: false };
  });
}

// ---------------------------------------------------------------------------------------------
// verification

export interface CounterDrift {
  budgetId: string;
  periodKey: string;
  expected: Usage;
  actual: Usage;
}

/**
 * Invariant I2: budget_usage must equal the fold of the journal. The counters are a cache for
 * fast locking; the journal is the truth. A nightly job runs this and alerts on any drift.
 */
export async function verifyCounters(db: DbOrTx, orgId: string): Promise<{ ok: boolean; drift: CounterDrift[] }> {
  return db.transaction(async (tx) => {
    const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.orgId, orgId));
    const holdRows = await tx.select({ id: holds.id, amount: holds.amount }).from(holds).where(eq(holds.orgId, orgId));
    const budgetRows = await tx
      .select({ id: budgets.id, unit: budgets.unit })
      .from(budgets)
      .where(eq(budgets.orgId, orgId));
    const holdAmounts = new Map(holdRows.map((row) => [row.id, row.amount]));
    const units = new Map(budgetRows.map((row) => [row.id, row.unit]));

    const expected = new Map<string, Usage>();
    const bump = (budgetId: string, key: string, held: bigint, spent: bigint) => {
      const id = usageKey(budgetId, key);
      const current = expected.get(id) ?? { held: 0n, spent: 0n };
      expected.set(id, { held: current.held + held, spent: current.spent + spent });
    };

    for (const entry of entries) {
      entry.budgetIds.forEach((budgetId, index) => {
        const key = entry.periodKeys[index] ?? '';
        const unit = unitOf(units, budgetId);
        const d = (amount: bigint) => delta(unit, amount);
        switch (entry.kind) {
          case 'hold':
            bump(budgetId, key, d(entry.amount), 0n);
            break;
          case 'release':
            bump(budgetId, key, -d(entry.amount), 0n);
            break;
          case 'capture': {
            const holdAmount = entry.holdId === null ? undefined : holdAmounts.get(entry.holdId);
            if (holdAmount === undefined) throw new Error(`capture ${entry.id} has no hold`);
            bump(budgetId, key, -d(holdAmount), d(entry.amount));
            break;
          }
          case 'unheld_capture':
          case 'observed':
            bump(budgetId, key, 0n, d(entry.amount));
            break;
          case 'refund':
            if (unit === 'micros') bump(budgetId, key, 0n, -entry.amount);
            break;
          case 'adjustment':
            if (unit === 'micros') bump(budgetId, key, 0n, entry.amount);
            break;
        }
      });
    }

    const actualRows = await tx
      .select({
        budgetId: budgetUsage.budgetId,
        periodKey: budgetUsage.periodKey,
        held: budgetUsage.held,
        spent: budgetUsage.spent,
      })
      .from(budgetUsage)
      .innerJoin(budgets, eq(budgets.id, budgetUsage.budgetId))
      .where(eq(budgets.orgId, orgId));

    const drift: CounterDrift[] = [];
    const seen = new Set<string>();
    for (const row of actualRows) {
      const id = usageKey(row.budgetId, row.periodKey);
      seen.add(id);
      const want = expected.get(id) ?? { held: 0n, spent: 0n };
      if (want.held !== row.held || want.spent !== row.spent) {
        drift.push({
          budgetId: row.budgetId,
          periodKey: row.periodKey,
          expected: want,
          actual: { held: row.held, spent: row.spent },
        });
      }
    }
    for (const [id, want] of expected) {
      if (seen.has(id) || (want.held === 0n && want.spent === 0n)) continue;
      const [budgetId = '', periodKeyValue = ''] = id.split('|');
      drift.push({ budgetId, periodKey: periodKeyValue, expected: want, actual: { held: 0n, spent: 0n } });
    }
    return { ok: drift.length === 0, drift };
  });
}
