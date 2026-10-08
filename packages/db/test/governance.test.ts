import { randomBytes } from 'node:crypto';
import { evaluatePosture, type AttestationDocument } from '@aperture/core';
import { keyRingFromEnv, merkleRoot, verifyJws } from '@aperture/crypto';
import { count, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAttestation, platformJwks, rotatePlatformSigningKey } from '../src/attestations';
import { appendAuditEvent, exportAuditEvents } from '../src/audit';
import { connect, withOrg, type DatabaseHandle } from '../src/client';
import { recordSpend } from '../src/ledger';
import { collectPostureSnapshot, coverageAmounts, inventoryRows } from '../src/posture';
import {
  budgetUsage,
  externalSpend,
  fxRates,
  holds,
  ledgerEntries,
  orgSettings,
  receipts,
  seats,
  statementUploads,
  telemetryTokens,
  toolUsageDaily,
  users,
} from '../src/schema';
import { addToolUsage, convertToMicros, upsertSeat } from '../src/seats';
import { appRoleUrl, createTestDatabase } from './database';
import { nextKey, seedTree, usd } from './fixtures';

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

async function seedUser(email = `${nextKey('u')}@example.com`) {
  const id = nextKey('user');
  await system.db.insert(users).values({ id, name: email, email, emailVerified: true });
  return id;
}

const ledgerCounts = async (orgId: string) => ({
  entries: (await system.db.select({ n: count() }).from(ledgerEntries).where(eq(ledgerEntries.orgId, orgId)))[0]?.n,
  holds: (await system.db.select({ n: count() }).from(holds).where(eq(holds.orgId, orgId)))[0]?.n,
  usage: (await system.db.select({ n: count() }).from(budgetUsage))[0]?.n,
});

describe('tenant isolation of the Phase 11–12 tables', () => {
  it('hides every new table’s rows from other orgs', async () => {
    const a = await seedTree(system.db);
    const b = await seedTree(system.db);
    const user = await seedUser();
    await upsertSeat(system.db, {
      orgId: b.org.id,
      dedupeKey: 'manual:x',
      toolId: 'cursor',
      plan: 'pro',
      userId: user,
      externalUserRef: null,
      source: 'manual',
    });
    await system.db.insert(telemetryTokens).values({
      id: uuidv7(),
      orgId: b.org.id,
      userId: user,
      tool: 'claude_code',
      name: 't',
      prefix: 'apt_tel_x',
      hash: randomBytes(16).toString('hex'),
      createdBy: user,
    });
    const seen = await withOrg(app.db, a.org.id, async (tx) => ({
      seats: await tx.select().from(seats),
      tokens: await tx.select().from(telemetryTokens),
    }));
    expect(seen).toEqual({ seats: [], tokens: [] });
  });
});

describe('collectPostureSnapshot', () => {
  it('never selects a secret column', async () => {
    const tree = await seedTree(system.db);
    const statements: string[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored below; called with apply(this)
    const original = pg.Client.prototype.query;
    const spy = function (this: pg.Client, ...args: unknown[]) {
      const first = args[0];
      statements.push(typeof first === 'string' ? first : ((first as { text?: string }).text ?? ''));
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
    pg.Client.prototype.query = spy as typeof original;
    try {
      await withOrg(app.db, tree.org.id, (tx) =>
        collectPostureSnapshot(tx, tree.org.id, { verifyAudit: { from: null }, checkLedger: true }),
      );
    } finally {
      pg.Client.prototype.query = original;
    }
    expect(statements.length).toBeGreaterThan(10);
    for (const text of statements) {
      expect(text, text).not.toMatch(/secret|private_key/i);
      if (/\b(api_keys|telemetry_tokens)\b/.test(text)) expect(text, text).not.toMatch(/"hash"|\bhash\b/);
    }
  });

  it('describes an org well enough for the catalogue, and finds a tampered audit chain', async () => {
    const tree = await seedTree(system.db);
    await appendAuditEvent(system.db, tree.org.id, {
      actor: 'system:test',
      action: 'test.one',
      subject: 'x',
      data: {},
    });
    await appendAuditEvent(system.db, tree.org.id, {
      actor: 'system:test',
      action: 'test.two',
      subject: 'x',
      data: {},
    });
    const first = await withOrg(app.db, tree.org.id, (tx) =>
      collectPostureSnapshot(tx, tree.org.id, { verifyAudit: { from: null }, checkLedger: true }),
    );
    expect(first.snapshot.audit.chainIntact).toBe(true);
    expect(first.snapshot.ledgerDrift).toBe(false);
    expect(first.snapshot.budgets.some((b) => b.scope === 'org' && b.mode === 'hard')).toBe(true);
    expect(first.snapshot.agents.map((a) => a.name)).toContain('research-bot');
    expect(first.auditCheckpoint?.seq).toBe(2);
    const result = evaluatePosture(first.snapshot, { now: new Date() });
    expect(result.results.find((r) => r.id === 'spend.org_root_hard')?.status).toBe('pass');

    // Incremental: the next run starts after the checkpoint and still sees new events.
    await appendAuditEvent(system.db, tree.org.id, {
      actor: 'system:test',
      action: 'test.three',
      subject: 'x',
      data: {},
    });
    const second = await withOrg(app.db, tree.org.id, (tx) =>
      collectPostureSnapshot(tx, tree.org.id, { verifyAudit: { from: first.auditCheckpoint } }),
    );
    expect(second.auditCheckpoint?.seq).toBe(3);

    // Tamper with an event (bypassing the append-only trigger as a superuser would).
    await system.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update audit_events set data = '{"forged":true}' where org_id = ${tree.org.id} and seq = 2`);
    });
    const tampered = await withOrg(app.db, tree.org.id, (tx) =>
      collectPostureSnapshot(tx, tree.org.id, { verifyAudit: { from: null } }),
    );
    expect(tampered.snapshot.audit).toMatchObject({ chainIntact: false, brokenAtSeq: 2 });
  });
});

describe('external evidence never touches the ledger (INV-16, INV-17)', () => {
  it('leaves ledger entries, holds, and budget usage untouched', async () => {
    const tree = await seedTree(system.db);
    const user = await seedUser();
    const before = await ledgerCounts(tree.org.id);
    const uploadId = uuidv7();
    await system.db
      .insert(statementUploads)
      .values({ id: uploadId, orgId: tree.org.id, uploadedBy: user, fileName: 's.csv', rowsReceived: 1, rowsNew: 1 });
    await system.db.insert(externalSpend).values({
      id: uuidv7(),
      orgId: tree.org.id,
      occurredOn: '2026-10-01',
      amount: usd('20'),
      originalAmount: '20.00',
      originalCurrency: 'USD',
      descriptor: 'MIDJOURNEY INC.',
      toolId: 'midjourney',
      vendor: 'Midjourney',
      category: 'image',
      source: 'statement_upload',
      uploadId,
      dedupeHash: nextKey('h'),
    });
    await upsertSeat(system.db, {
      orgId: tree.org.id,
      dedupeKey: 'receipt:u:chatgpt',
      toolId: 'chatgpt',
      plan: 'plus',
      userId: user,
      externalUserRef: null,
      source: 'receipt',
      payer: 'personal_expensed',
      monthlyCost: usd('20'),
    });
    await system.db.insert(receipts).values({
      id: uuidv7(),
      orgId: tree.org.id,
      via: 'upload',
      messageHash: nextKey('m'),
      status: 'imported',
      trust: 'member',
    });
    await addToolUsage(system.db, tree.org.id, user, [
      {
        tool: 'claude_code',
        day: '2026-10-01',
        model: 'claude-sonnet-5-5',
        email: null,
        sessions: 1,
        inputTokens: 10n,
        outputTokens: 5n,
        cacheReadTokens: 0n,
        cacheWriteTokens: 0n,
        costMicros: 1234n,
        activeSeconds: 10,
        linesAdded: 0,
        linesRemoved: 0,
        commits: 0,
        pullRequests: 0,
      },
    ]);
    expect(await ledgerCounts(tree.org.id)).toEqual(before);
  });

  it('adds telemetry batches together instead of replacing them', async () => {
    const tree = await seedTree(system.db);
    const user = await seedUser();
    const row = {
      tool: 'claude_code' as const,
      day: '2026-10-02',
      model: 'm',
      email: null,
      sessions: 1,
      inputTokens: 100n,
      outputTokens: 10n,
      cacheReadTokens: 0n,
      cacheWriteTokens: 0n,
      costMicros: 500n,
      activeSeconds: 5,
      linesAdded: 1,
      linesRemoved: 0,
      commits: 0,
      pullRequests: 0,
    };
    await addToolUsage(system.db, tree.org.id, user, [row]);
    await addToolUsage(system.db, tree.org.id, user, [row]);
    const [stored] = await system.db.select().from(toolUsageDaily).where(eq(toolUsageDaily.userId, user));
    expect(stored).toMatchObject({ sessions: 2, inputTokens: 200n, cost: 1000n });
  });
});

describe('coverage and inventory', () => {
  it('splits spend by governance status and lists what can spend', async () => {
    const tree = await seedTree(system.db);
    await recordSpend(system.db, {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'gateway',
      kind: 'observed',
      amount: usd('3'),
      idempotencyKey: nextKey('spend'),
      occurredAt: new Date(),
      meta: { model: 'gpt-5-mini' },
    });
    await system.db.insert(externalSpend).values({
      id: uuidv7(),
      orgId: tree.org.id,
      occurredOn: new Date().toISOString().slice(0, 10),
      amount: usd('1'),
      originalAmount: '1',
      originalCurrency: 'USD',
      descriptor: 'PERPLEXITY.AI',
      toolId: 'perplexity',
      vendor: 'Perplexity',
      category: 'search',
      source: 'statement_upload',
      dedupeHash: nextKey('h'),
    });
    const now = Date.now();
    const amounts = await withOrg(app.db, tree.org.id, (tx) =>
      coverageAmounts(tx, tree.org.id, { from: new Date(now - 86_400_000), to: new Date(now + 86_400_000) }),
    );
    expect(amounts.enforced).toBe(usd('3'));
    expect(amounts.external).toBe(usd('1'));
    const rows = await withOrg(app.db, tree.org.id, (tx) => inventoryRows(tx, tree.org.id));
    expect(rows.find((r) => r.kind === 'agent')).toMatchObject({ name: 'research-bot', status: 'enforced' });
    expect(rows.find((r) => r.kind === 'external_tool')).toMatchObject({ id: 'perplexity', status: 'external' });
    expect(rows.find((r) => r.kind === 'model')).toMatchObject({ name: 'gpt-5-mini' });
  });

  it('converts currencies at the day’s rate, or the latest earlier one', async () => {
    await system.db
      .insert(fxRates)
      .values({ currency: 'AED', day: '2026-09-30', microsPerUnit: 272_294n, source: 'test' })
      .onConflictDoNothing();
    expect(await convertToMicros(system.db, '73.45', 'AED', '2026-10-05')).toBe(19_999_994n); // 73.45 × 0.272294 = 19.9999943
    expect(await convertToMicros(system.db, '20', 'USD', '2026-10-05')).toBe(20_000_000n);
    expect(await convertToMicros(system.db, '5', 'XYZ', '2026-10-05')).toBeNull();
  });
});

describe('attestations', () => {
  it('signs a document anyone can verify, and keeps verifying after key rotation', async () => {
    const tree = await seedTree(system.db);
    const user = await seedUser();
    for (const action of ['approval.approved', 'mandate.issued', 'agents.paused_all'])
      await appendAuditEvent(system.db, tree.org.id, { actor: 'system:test', action, subject: 'x', data: {} });
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 60_000);
    const issuer = {
      kind: 'aperture_cloud' as const,
      instance: 'test',
      jwksUrl: 'https://example.test/.well-known/aperture/jwks.json',
    };
    const created = await withOrg(app.db, tree.org.id, (tx) =>
      createAttestation(tx, ring, { orgId: tree.org.id, from, to, createdBy: user, issuer, apertureVersion: 'test' }),
    );
    const jwks = await platformJwks(app.db);
    const { payload } = verifyJws(created.jws, jwks);
    const document = payload as unknown as AttestationDocument;
    expect(document.activity).toMatchObject({ approvals: { granted: 1 }, mandates: { issued: 1 }, killSwitchUses: 1 });
    expect(document.audit.chainIntact).toBe(true);
    const records = await exportAuditEvents(system.db, tree.org.id, {
      fromSeq: document.audit.firstSeq ?? 0,
      toSeq: document.audit.lastSeq ?? 0,
    });
    // What `pnpm attestation-verify --audit` recomputes from the export.
    expect(document.audit.merkleRoot).toBe(merkleRoot(records.map((r) => r.hash)));
    expect(document.audit).toMatchObject({
      events: records.length,
      prevHash: records[0]?.prevHash,
      lastHash: records.at(-1)?.hash,
    });
    expect(JSON.stringify(document)).not.toMatch(/@example\.com/);

    // One flipped character in the payload breaks the signature.
    const [header, body, signature] = created.jws.split('.');
    const forged = JSON.parse(Buffer.from(body ?? '', 'base64url').toString()) as AttestationDocument;
    forged.posture.score = 100;
    const tampered = [header ?? '', Buffer.from(JSON.stringify(forged)).toString('base64url'), signature ?? ''].join(
      '.',
    );
    expect(() => verifyJws(tampered, jwks)).toThrow();

    // V6: a period older than request-log retention still gets its numbers from the ledger and
    // audit chain, and says that denials may be missing instead of reporting zero.
    expect(document.activity.decisions.requestLogComplete).toBe(true);
    await system.db
      .insert(orgSettings)
      .values({ orgId: tree.org.id, requestLogDays: 7 })
      .onConflictDoUpdate({ target: orgSettings.orgId, set: { requestLogDays: 7 } });
    const older = await withOrg(app.db, tree.org.id, (tx) =>
      createAttestation(tx, ring, {
        orgId: tree.org.id,
        from: new Date(Date.now() - 30 * 86_400_000),
        to,
        createdBy: user,
        issuer,
        apertureVersion: 'test',
      }),
    );
    expect(older.document.activity.decisions.requestLogComplete).toBe(false);
    expect(older.document.activity).toMatchObject({ approvals: { granted: 1 }, mandates: { issued: 1 } });

    await rotatePlatformSigningKey(app.db, ring);
    expect(() => verifyJws(created.jws, { keys: [] })).toThrow();
    expect(verifyJws(created.jws, await platformJwks(app.db)).payload.id).toBe(created.id);
  });
});
