import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAuditEvent, exportAuditEvents } from '../src/audit';
import { connect, withOrg, withSystem, type DatabaseHandle } from '../src/client';
import { reserve } from '../src/ledger';
import { budgetUsage, budgets, orgs, principals } from '../src/schema';
import { appRoleUrl, createTestDatabase } from './database';
import { expectDbError, reserveInput, seedTree, usd } from './fixtures';

// `system` is the test helper's all-orgs connection; `app` behaves like the API's pool.
let system: DatabaseHandle & { url: string };
let app: DatabaseHandle;

beforeAll(async () => {
  system = await createTestDatabase();
  app = connect(appRoleUrl(system.url));
});
afterAll(async () => {
  await app.close();
  await system.close();
});

describe('row-level security', () => {
  it('shows nothing to a connection that has not declared an org', async () => {
    await seedTree(system.db);
    expect(await app.db.select().from(orgs)).toEqual([]);
    expect(await app.db.select().from(budgets)).toEqual([]);
    expect(await app.db.select().from(budgetUsage)).toEqual([]);
  });

  it('scopes a transaction to exactly one org for reads', async () => {
    const a = await seedTree(system.db);
    const b = await seedTree(system.db);
    await reserve(system.db, reserveInput(b.org.id, b.agent.id, usd('1')));

    const seen = await withOrg(app.db, a.org.id, async (tx) => ({
      orgs: (await tx.select({ id: orgs.id }).from(orgs)).map((row) => row.id),
      budgets: (await tx.select({ orgId: budgets.orgId }).from(budgets)).map((row) => row.orgId),
      // A filter naming the other org still returns nothing.
      otherPrincipals: await tx.select().from(principals).where(eq(principals.orgId, b.org.id)),
      otherUsage: await tx.select().from(budgetUsage).where(eq(budgetUsage.budgetId, b.agentBudget.id)),
    }));
    expect(seen.orgs).toEqual([a.org.id]);
    expect(new Set(seen.budgets)).toEqual(new Set([a.org.id]));
    expect(seen.otherPrincipals).toEqual([]);
    expect(seen.otherUsage).toEqual([]);
  });

  it('refuses writes into another org', async () => {
    const a = await seedTree(system.db);
    const b = await seedTree(system.db);
    await expectDbError(
      withOrg(app.db, a.org.id, (tx) =>
        tx.insert(principals).values({ id: crypto.randomUUID(), orgId: b.org.id, kind: 'agent', name: 'intruder' }),
      ),
      /row-level security/,
    );
    await expectDbError(
      withOrg(app.db, a.org.id, (tx) =>
        appendAuditEvent(tx, b.org.id, { actor: 'x', action: 'y', subject: 'z', data: {} }),
      ),
      /row-level security/,
    );
  });

  it('lets the ledger and audit log work inside an org-scoped transaction (the API path)', async () => {
    const a = await seedTree(system.db);
    const result = await withOrg(app.db, a.org.id, (tx) => reserve(tx, reserveInput(a.org.id, a.agent.id, usd('2'))));
    expect(result.ok).toBe(true);
    await withOrg(app.db, a.org.id, (tx) =>
      appendAuditEvent(tx, a.org.id, { actor: 'user:1', action: 'budget.created', subject: 'budget:1', data: {} }),
    );
    const exported = await withOrg(app.db, a.org.id, (tx) => exportAuditEvents(tx, a.org.id));
    expect(exported).toHaveLength(1);
  });

  it('a reserve scoped to one org cannot touch another org’s principal', async () => {
    const a = await seedTree(system.db);
    const b = await seedTree(system.db);
    await expect(
      withOrg(app.db, a.org.id, (tx) => reserve(tx, reserveInput(b.org.id, b.agent.id, usd('1')))),
    ).rejects.toMatchObject({ code: 'principal_not_found' });
  });

  it('withSystem sees every org', async () => {
    const a = await seedTree(system.db);
    const count = await withSystem(app.db, async (tx) => {
      const rows = await tx.execute<{ n: number }>(sql`select count(*)::int as n from orgs where id = ${a.org.id}`);
      return rows.rows[0]?.n;
    });
    expect(count).toBe(1);
  });
});
