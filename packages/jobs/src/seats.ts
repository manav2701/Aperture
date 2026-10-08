import { isSeatProvider, seatConnectorFor, type SeatConnector } from '@aperture/connectors';
import { formatUsd, micros } from '@aperture/core';
import {
  and,
  eq,
  inArray,
  readConnectionSecret,
  recordSeatDay,
  refreshSeatIdleness,
  schema,
  setSeatExtraUsage,
  sql,
  upsertSeat,
  withOrg,
  withSystem,
} from '@aperture/db';
import { queueAlert } from './alerts';
import { dbOf, type JobDeps } from './deps';

/*
 * Seat sync (plan/phases/phase-12 §12.2): read-only. Seats from a connector are matched to
 * members by email; unmatched ones keep the vendor's reference until someone links them. Recent
 * days are re-read on every sync (vendors revise them) and replace earlier readings. Nothing
 * here touches the ledger (INV-17).
 */

const SYNC_WINDOW_MS = 7 * 86_400_000;

type ConnectionRow = typeof schema.connections.$inferSelect;

export async function seatConnectorForConnection(deps: JobDeps, connection: ConnectionRow): Promise<SeatConnector> {
  if (!isSeatProvider(connection.provider)) throw new Error(`no seat connector for ${connection.provider}`);
  const secret = await withOrg(dbOf(deps), connection.orgId, (tx) =>
    readConnectionSecret(tx, deps.ring, { orgId: connection.orgId, connectionId: connection.id }),
  );
  if (secret === undefined) throw new Error('connection disappeared');
  return seatConnectorFor(connection.provider, {
    secret,
    config: connection.config as Record<string, unknown>,
    fetch: deps.fetch,
  });
}

export interface SeatSyncResult {
  seats: number;
  matched: number;
  days: number;
}

export async function syncSeatConnection(deps: JobDeps, connection: ConnectionRow): Promise<SeatSyncResult> {
  const connector = await seatConnectorForConnection(deps, connection);
  const orgId = connection.orgId;
  try {
    const now = new Date();
    const [records, days] = await Promise.all([
      connector.listSeats(),
      connector.usage(new Date(now.getTime() - SYNC_WINDOW_MS), now),
    ]);
    const result = await withOrg(dbOf(deps), orgId, async (tx) => {
      const people = await tx
        .select({ userId: schema.members.userId, email: schema.users.email })
        .from(schema.members)
        .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.members.orgId, orgId));
      const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p.userId]));
      // Earlier links an admin made by hand survive a sync (upsertSeat keeps an existing user).
      const seatIds = new Map<string, string>();
      let matched = 0;
      for (const record of records) {
        const userId = record.email === null ? null : (byEmail.get(record.email) ?? null);
        if (userId !== null) matched += 1;
        const { id } = await upsertSeat(tx, {
          orgId,
          dedupeKey: `connection:${connection.id}:${record.externalId}`,
          toolId: connector.toolId,
          plan: record.plan,
          userId,
          externalUserRef: record.email ?? record.externalId,
          source: 'connector',
          payer: 'company',
          status: record.active ? 'active' : 'cancelled',
          lastActiveAt: record.lastActiveAt,
          connectionId: connection.id,
        });
        seatIds.set(record.externalId, id);
        if (record.email !== null) seatIds.set(record.email, id);
        if (record.extraUsageCycle !== undefined)
          await setSeatExtraUsage(tx, {
            seatId: id,
            orgId,
            day: record.extraUsageCycle.cycleStart,
            amount: record.extraUsageCycle.amount,
          });
      }
      let written = 0;
      for (const day of days) {
        const seatId = seatIds.get(day.externalId) ?? (day.email === null ? undefined : seatIds.get(day.email));
        if (seatId === undefined) continue;
        await recordSeatDay(tx, {
          seatId,
          orgId,
          day: day.day,
          active: day.active,
          requests: day.requests,
          tokens: day.tokens,
          estimatedCost: (day.models ?? []).reduce((sum, m) => sum + m.cost, 0n),
        });
        if (day.active)
          await tx
            .update(schema.seats)
            .set({ lastActiveAt: sql`greatest(${schema.seats.lastActiveAt}, ${`${day.day}T00:00:00Z`}::timestamptz)` })
            .where(eq(schema.seats.id, seatId));
        written += 1;
      }
      await tx
        .update(schema.connections)
        .set({ lastSyncedAt: new Date(), lastError: null, status: 'active', updatedAt: new Date() })
        .where(eq(schema.connections.id, connection.id));
      // A sync reports every seat as it is now, so idleness is worked out again straight away.
      await refreshSeatIdleness(tx, orgId, new Date());
      return { seats: records.length, matched, days: written };
    });
    return result;
  } catch (error) {
    const message = (error as Error).message.slice(0, 300);
    await withOrg(dbOf(deps), orgId, (tx) =>
      tx
        .update(schema.connections)
        .set({ lastError: message, status: 'broken', updatedAt: new Date() })
        .where(eq(schema.connections.id, connection.id)),
    );
    await queueAlert(deps, orgId, {
      dedupeKey: `connection-broken:${connection.id}:${new Date().toISOString().slice(0, 10)}`,
      kind: 'connection_broken',
      payload: { name: connection.name, provider: connection.provider, error: message },
    });
    throw error;
  }
}

/** Every six hours: sync every active seat connection. A failing one doesn't stop the others. */
export async function syncAllSeatConnections(deps: JobDeps): Promise<number> {
  const connections = await withSystem(dbOf(deps), (tx) =>
    tx
      .select()
      .from(schema.connections)
      .where(
        and(
          sql`${schema.connections.provider} like 'seat:%'`,
          inArray(schema.connections.status, ['active', 'broken']),
        ),
      ),
  );
  let synced = 0;
  for (const connection of connections) {
    try {
      await syncSeatConnection(deps, connection);
      synced += 1;
    } catch (error) {
      deps.logger.warn({ err: error, connection: connection.id }, 'seat sync failed');
    }
  }
  return synced;
}

/**
 * Daily: mark connector and imported seats idle once they pass the org's idle threshold, and
 * active again when activity comes back (§12.7). Returns how many seats changed.
 */
export async function refreshAllSeatIdleness(deps: JobDeps, now = new Date()): Promise<number> {
  const orgs = await withSystem(dbOf(deps), (tx) =>
    tx
      .selectDistinct({ orgId: schema.seats.orgId })
      .from(schema.seats)
      .where(inArray(schema.seats.source, ['connector', 'import'])),
  );
  let changed = 0;
  for (const { orgId } of orgs)
    changed += await withOrg(dbOf(deps), orgId, (tx) => refreshSeatIdleness(tx, orgId, now));
  return changed;
}

/** Daily: alert when seat overage in the last 30 days passes the org's threshold (§12.7). */
export async function checkSeatOverage(deps: JobDeps): Promise<number> {
  const rows = await withSystem(dbOf(deps), (tx) =>
    tx.execute<{ org_id: string; threshold: string; total: string }>(sql`
      select s.org_id, s.extra_usage_alert::text as threshold, coalesce(sum(d.extra_usage_cost), 0)::text as total
      from org_settings s join seat_usage_daily d on d.org_id = s.org_id
      where s.extra_usage_alert is not null and d.day >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
      group by s.org_id, s.extra_usage_alert`),
  );
  let alerted = 0;
  for (const row of rows.rows) {
    if (BigInt(row.total) <= BigInt(row.threshold)) continue;
    await queueAlert(deps, row.org_id, {
      dedupeKey: `seat-overage:${new Date().toISOString().slice(0, 7)}`,
      kind: 'seat_extra_usage',
      payload: { total: formatUsd(micros(BigInt(row.total))), threshold: formatUsd(micros(BigInt(row.threshold))) },
    });
    alerted += 1;
  }
  return alerted;
}
