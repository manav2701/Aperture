import { GENESIS_HASH, merkleRoot, verifyChain } from '@aperture/crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAuditEvent, auditRoot, exportAuditEvents } from '../src/audit';
import type { DatabaseHandle } from '../src/client';
import { createOrg } from '../src/entities';
import { createTestDatabase } from './database';
import { expectDbError } from './fixtures';

let handle: DatabaseHandle;
beforeAll(async () => {
  handle = await createTestDatabase({ maxConnections: 30 });
});
afterAll(async () => {
  await handle.close();
});

const event = (n: number) => ({
  actor: 'user:finance-1',
  action: 'budget.limit.changed',
  subject: 'budget:marketing',
  data: { from: '50.00', to: String(n), reason: 'Q4 campaign' },
});

describe('audit chain', () => {
  it('chains events per org and exports records that verify offline', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'audit' });
    const first = await appendAuditEvent(db, org.id, event(1));
    await appendAuditEvent(db, org.id, event(2));
    await appendAuditEvent(db, org.id, event(3));
    expect(first.seq).toBe(1);

    const records = await exportAuditEvents(db, org.id);
    expect(records.map((record) => record.seq)).toEqual([1, 2, 3]);
    expect(records[0]?.prevHash).toBe(GENESIS_HASH);
    expect(verifyChain(records)).toMatchObject({ ok: true, count: 3 });
    expect(auditRoot(records)).toBe(merkleRoot(records.map((record) => record.hash)));

    // A segment verifies given the hash before it.
    expect(verifyChain(records.slice(1), { startPrevHash: records[0]?.hash ?? '' }).ok).toBe(true);
    expect((await exportAuditEvents(db, org.id, { fromSeq: 2, toSeq: 2 })).map((record) => record.seq)).toEqual([2]);
  });

  it('keeps sequence numbers gapless and the chain unforked under concurrent writers', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'audit-concurrent' });
    await Promise.all(Array.from({ length: 60 }, (_, n) => appendAuditEvent(db, org.id, event(n))));
    const records = await exportAuditEvents(db, org.id);
    expect(records.map((record) => record.seq)).toEqual(Array.from({ length: 60 }, (_, n) => n + 1));
    expect(verifyChain(records).ok).toBe(true);
  });

  it('keeps chains independent per org', async () => {
    const { db } = handle;
    const a = await createOrg(db, { name: 'a' });
    const b = await createOrg(db, { name: 'b' });
    await appendAuditEvent(db, a.id, event(1));
    await appendAuditEvent(db, b.id, event(1));
    const [recordA] = await exportAuditEvents(db, a.id);
    const [recordB] = await exportAuditEvents(db, b.id);
    expect(recordA?.seq).toBe(1);
    expect(recordB?.seq).toBe(1);
    expect(recordA?.hash).not.toBe(recordB?.hash);
  });

  it('refuses in-place edits, and an exported copy that was edited fails verification (O5)', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'audit-tamper' });
    await appendAuditEvent(db, org.id, event(1));
    await appendAuditEvent(db, org.id, event(2));
    await expectDbError(db.execute(sql`update audit_events set actor = 'user:someone-else'`), /append-only/);
    await expectDbError(db.execute(sql`delete from audit_events`), /append-only/);

    const records = await exportAuditEvents(db, org.id);
    const edited = records.map((record) =>
      record.seq === 1 ? { ...record, body: { ...(record.body as object), actor: 'user:someone-else' } } : record,
    );
    expect(verifyChain(edited)).toMatchObject({ ok: false, seq: 1, reason: 'hash_mismatch' });
  });

  it('refuses data that is not plain JSON', async () => {
    const { db } = handle;
    const org = await createOrg(db, { name: 'audit-json' });
    await expect(
      appendAuditEvent(db, org.id, { ...event(1), data: { amount: 5n } as unknown as { amount: string } }),
    ).rejects.toThrow(/not plain JSON/);
  });
});
