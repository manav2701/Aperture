import type { ToolUsageRow } from '@aperture/core';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { DbOrTx } from './client';
import { fxRates, seatUsageDaily, seats, toolUsageDaily } from './schema';

/*
 * Seats, subscriptions, and terminal-tool usage (plan/phases/phase-12). None of these functions
 * touch ledger_entries, holds, or budget_usage (INV-17): seats are visible, never enforced.
 */

/**
 * Converts a decimal amount in `currency` to µUSD at the rate for `day` (or the latest earlier
 * day), rounding half up. Returns null when no rate is known for that currency.
 */
export async function convertToMicros(
  tx: DbOrTx,
  amount: string,
  currency: string,
  day: string,
): Promise<bigint | null> {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount);
  if (match === null) return null;
  const units = BigInt(match[1] ?? '0') * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  const code = currency.toUpperCase();
  if (code === 'USD') return units;
  const [rate] = await tx
    .select({ microsPerUnit: fxRates.microsPerUnit })
    .from(fxRates)
    .where(and(eq(fxRates.currency, code), lte(fxRates.day, day)))
    .orderBy(desc(fxRates.day))
    .limit(1);
  if (rate === undefined) return null;
  return (units * rate.microsPerUnit + 500_000n) / 1_000_000n;
}

export interface SeatInput {
  orgId: string;
  dedupeKey: string;
  toolId: string;
  plan: string | null;
  userId: string | null;
  externalUserRef: string | null;
  source: (typeof seats.$inferInsert)['source'];
  payer?: (typeof seats.$inferInsert)['payer'];
  monthlyCost?: bigint | null;
  originalAmount?: string | null;
  currency?: string | null;
  renewsOn?: string | null;
  status?: (typeof seats.$inferInsert)['status'];
  lastActiveAt?: Date | null;
  connectionId?: string | null;
}

/** Inserts or refreshes a seat by its source key; returns its id and whether it was new. */
export async function upsertSeat(tx: DbOrTx, input: SeatInput): Promise<{ id: string; created: boolean }> {
  const values = {
    id: uuidv7(),
    orgId: input.orgId,
    dedupeKey: input.dedupeKey,
    toolId: input.toolId,
    plan: input.plan,
    userId: input.userId,
    externalUserRef: input.externalUserRef,
    source: input.source,
    payer: input.payer ?? 'unknown',
    monthlyCost: input.monthlyCost ?? null,
    originalAmount: input.originalAmount ?? null,
    currency: input.currency ?? null,
    renewsOn: input.renewsOn ?? null,
    status: input.status ?? 'active',
    lastActiveAt: input.lastActiveAt ?? null,
    connectionId: input.connectionId ?? null,
    lastSyncedAt: new Date(),
  };
  const [row] = await tx
    .insert(seats)
    .values(values)
    .onConflictDoUpdate({
      target: [seats.orgId, seats.dedupeKey],
      set: {
        plan: sql`coalesce(excluded.plan, ${seats.plan})`,
        userId: sql`coalesce(excluded.user_id, ${seats.userId})`,
        externalUserRef: sql`coalesce(excluded.external_user_ref, ${seats.externalUserRef})`,
        monthlyCost: sql`coalesce(excluded.monthly_cost, ${seats.monthlyCost})`,
        originalAmount: sql`coalesce(excluded.original_amount, ${seats.originalAmount})`,
        currency: sql`coalesce(excluded.currency, ${seats.currency})`,
        renewsOn: sql`coalesce(excluded.renews_on, ${seats.renewsOn})`,
        // A connector reporting the seat again means it exists; people cancel by hand.
        status: sql`case when ${seats.status} = 'cancelled' and excluded.source <> 'connector' then ${seats.status} else excluded.status end`,
        lastActiveAt: sql`greatest(excluded.last_active_at, ${seats.lastActiveAt})`,
        lastSyncedAt: sql`excluded.last_synced_at`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: seats.id, createdAt: seats.createdAt, updatedAt: seats.updatedAt });
  if (!row) throw new Error('seat upsert returned nothing');
  return { id: row.id, created: row.id === values.id };
}

/**
 * Records one day of a seat's activity. Connectors re-read recent days on every sync, so the
 * source's latest numbers replace earlier ones (never added). Overage is set separately.
 */
export async function recordSeatDay(
  tx: DbOrTx,
  input: {
    seatId: string;
    orgId: string;
    day: string;
    active: boolean;
    requests: number;
    tokens: bigint;
    estimatedCost?: bigint;
  },
): Promise<void> {
  const values = { ...input, estimatedCost: input.estimatedCost ?? 0n };
  await tx
    .insert(seatUsageDaily)
    .values(values)
    .onConflictDoUpdate({
      target: [seatUsageDaily.seatId, seatUsageDaily.day],
      set: {
        active: values.active,
        requests: values.requests,
        tokens: values.tokens,
        estimatedCost: values.estimatedCost,
      },
    });
}

/** Records the vendor's overage for a billing cycle on the cycle's first day (replacing the last reading). */
export async function setSeatExtraUsage(
  tx: DbOrTx,
  input: { seatId: string; orgId: string; day: string; amount: bigint },
): Promise<void> {
  await tx
    .insert(seatUsageDaily)
    .values({ seatId: input.seatId, orgId: input.orgId, day: input.day, active: false, extraUsageCost: input.amount })
    .onConflictDoUpdate({ target: [seatUsageDaily.seatId, seatUsageDaily.day], set: { extraUsageCost: input.amount } });
}

/** Adds a telemetry batch to the member's daily totals (delta counters only ever add up). */
export async function addToolUsage(
  tx: DbOrTx,
  orgId: string,
  userId: string,
  rows: readonly ToolUsageRow[],
): Promise<void> {
  for (const row of rows) {
    await tx
      .insert(toolUsageDaily)
      .values({
        orgId,
        userId,
        tool: row.tool,
        day: row.day,
        model: row.model,
        sessions: row.sessions,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        cost: row.costMicros,
        activeSeconds: row.activeSeconds,
        linesAdded: row.linesAdded,
        linesRemoved: row.linesRemoved,
        commits: row.commits,
        pullRequests: row.pullRequests,
      })
      .onConflictDoUpdate({
        target: [
          toolUsageDaily.orgId,
          toolUsageDaily.userId,
          toolUsageDaily.tool,
          toolUsageDaily.day,
          toolUsageDaily.model,
        ],
        set: {
          sessions: sql`${toolUsageDaily.sessions} + excluded.sessions`,
          inputTokens: sql`${toolUsageDaily.inputTokens} + excluded.input_tokens`,
          outputTokens: sql`${toolUsageDaily.outputTokens} + excluded.output_tokens`,
          cacheReadTokens: sql`${toolUsageDaily.cacheReadTokens} + excluded.cache_read_tokens`,
          cacheWriteTokens: sql`${toolUsageDaily.cacheWriteTokens} + excluded.cache_write_tokens`,
          cost: sql`${toolUsageDaily.cost} + excluded.cost`,
          activeSeconds: sql`${toolUsageDaily.activeSeconds} + excluded.active_seconds`,
          linesAdded: sql`${toolUsageDaily.linesAdded} + excluded.lines_added`,
          linesRemoved: sql`${toolUsageDaily.linesRemoved} + excluded.lines_removed`,
          commits: sql`${toolUsageDaily.commits} + excluded.commits`,
          pullRequests: sql`${toolUsageDaily.pullRequests} + excluded.pull_requests`,
          updatedAt: new Date(),
        },
      });
  }
}
