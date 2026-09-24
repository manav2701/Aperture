import { GENESIS_HASH, chainHash, merkleRoot, type ChainRecord, type JsonValue } from '@aperture/crypto';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { DbOrTx } from './client';
import { dbNow } from './ledger';
import { auditEvents, auditOrgCounters } from './schema';

export interface AuditEventInput {
  /** Who acted: `user:<id>`, `agent:<id>`, or `system:<component>`. */
  actor: string;
  /** What happened, e.g. `ledger.reserve.denied`, `budget.limit.changed`. */
  action: string;
  /** What it happened to, e.g. `budget:<id>`. */
  subject: string;
  /** Plain JSON only: money as decimal strings, times as ISO strings. */
  data: Record<string, JsonValue>;
}

type AuditRow = typeof auditEvents.$inferSelect;

/** The exact object that is hashed. Everything an auditor relies on is inside it, including seq. */
function eventBody(
  row: Pick<AuditRow, 'orgId' | 'seq' | 'id' | 'occurredAt' | 'actor' | 'action' | 'subject' | 'data'>,
) {
  return {
    orgId: row.orgId,
    seq: row.seq,
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actor,
    action: row.action,
    subject: row.subject,
    data: row.data as JsonValue,
  } satisfies JsonValue;
}

/**
 * Appends an event to the org's hash chain. The per-org counter row is locked for the rest of
 * the transaction, so sequence numbers are gapless and the chain never forks. Call it inside
 * the same transaction as the change it records.
 */
export async function appendAuditEvent(
  db: DbOrTx,
  orgId: string,
  event: AuditEventInput,
): Promise<{ seq: number; hash: string }> {
  return db.transaction(async (tx) => {
    await tx.insert(auditOrgCounters).values({ orgId, lastSeq: 0, lastHash: GENESIS_HASH }).onConflictDoNothing();
    const [counter] = await tx.select().from(auditOrgCounters).where(eq(auditOrgCounters.orgId, orgId)).for('update');
    if (!counter) throw new Error('audit counter missing after insert');

    // Millisecond precision, so the stored timestamp round-trips exactly and the hash verifies.
    const occurredAt = await dbNow(tx);

    const row = {
      orgId,
      seq: counter.lastSeq + 1,
      id: uuidv7(),
      occurredAt,
      actor: event.actor,
      action: event.action,
      subject: event.subject,
      data: event.data,
    };
    const hash = chainHash(counter.lastHash, eventBody(row));
    await tx.insert(auditEvents).values({ ...row, prevHash: counter.lastHash, hash });
    await tx
      .update(auditOrgCounters)
      .set({ lastSeq: row.seq, lastHash: hash })
      .where(eq(auditOrgCounters.orgId, orgId));
    return { seq: row.seq, hash };
  });
}

/** Chain records for an org (optionally a seq range), ready to write as JSON lines. */
export async function exportAuditEvents(
  db: DbOrTx,
  orgId: string,
  range: { fromSeq?: number; toSeq?: number } = {},
): Promise<ChainRecord[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.orgId, orgId),
        range.fromSeq === undefined ? undefined : gte(auditEvents.seq, range.fromSeq),
        range.toSeq === undefined ? undefined : lte(auditEvents.seq, range.toSeq),
      ),
    )
    .orderBy(asc(auditEvents.seq));
  return rows.map((row) => ({ seq: row.seq, prevHash: row.prevHash, hash: row.hash, body: eventBody(row) }));
}

/** Merkle root of a range of the chain (the daily anchor in plan/architecture §15). */
export function auditRoot(records: readonly ChainRecord[]): string {
  return merkleRoot(records.map((record) => record.hash));
}
