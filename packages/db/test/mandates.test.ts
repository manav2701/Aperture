import { randomBytes } from 'node:crypto';
import { keyRingFromEnv, verifyJws } from '@aperture/crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '../src/client';
import { createPrincipal } from '../src/entities';
import { reserve } from '../src/ledger';
import type { MandateError } from '../src/mandates';
import {
  consumeMandateUse,
  decideApproval,
  expireApprovals,
  issueMandate,
  orgJwks,
  requestApproval,
  revokeMandate,
  rotateSigningKey,
  usableApproval,
} from '../src/mandates';
import { apiKeys, approvals, mandates, principals, users } from '../src/schema';
import { createTestDatabase } from './database';
import { reserveInput, seedTree, usd } from './fixtures';

let handle: DatabaseHandle;
const ring = keyRingFromEnv({ APERTURE_KEK_V1: randomBytes(32).toString('base64') });
beforeAll(async () => {
  handle = await createTestDatabase();
});
afterAll(async () => {
  await handle.close();
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const within = (parent: { notBefore: Date; expiresAt: Date }) => ({
  notBefore: parent.notBefore.toISOString(),
  expiresAt: parent.expiresAt.toISOString(),
});
const scope = (overrides: Record<string, unknown> = {}) => ({
  rails: ['gateway' as const],
  models: ['openai/*'],
  maxPerAction: '1.00',
  budget: { limit: '5.00', period: 'day' as const },
  notBefore: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: hours(2),
  purpose: 'research',
  ...overrides,
});

async function user(name: string) {
  const [row] = await handle.db
    .insert(users)
    .values({ id: crypto.randomUUID(), name, email: `${name}-${crypto.randomUUID()}@example.com`, emailVerified: true })
    .returning();
  if (!row) throw new Error('user insert failed');
  return row;
}

describe('mandates', () => {
  it('are signed with the org key and verifiable from the published JWKS, across rotation', async () => {
    const tree = await seedTree(handle.db);
    const issuer = await user('issuer');
    const first = await issueMandate(handle.db, ring, {
      orgId: tree.org.id,
      subjectPrincipalId: tree.agent.id,
      scope: scope(),
      issuerUserId: issuer.id,
    });
    await rotateSigningKey(handle.db, ring, tree.org.id);
    const second = await issueMandate(handle.db, ring, {
      orgId: tree.org.id,
      subjectPrincipalId: tree.agent.id,
      scope: scope(),
      issuerUserId: issuer.id,
    });
    expect(first.kid).not.toBe(second.kid);
    const jwks = await orgJwks(handle.db, tree.org.id);
    expect(jwks.keys).toHaveLength(2);
    expect(verifyJws(first.jws, jwks).payload).toMatchObject({
      jti: first.id,
      sub: `aperture:principal:${tree.agent.id}`,
    });
    expect(verifyJws(second.jws, jwks).payload).toMatchObject({ jti: second.id });
    expect(JSON.stringify(jwks)).not.toContain('"d"');
  });

  it('let an agent delegate only a narrower scope to its sub-agent (P2), and no deeper than three levels', async () => {
    const tree = await seedTree(handle.db);
    const issuer = await user('issuer');
    const parent = await issueMandate(handle.db, ring, {
      orgId: tree.org.id,
      subjectPrincipalId: tree.agent.id,
      scope: scope(),
      issuerUserId: issuer.id,
    });
    const sub = await createPrincipal(handle.db, {
      orgId: tree.org.id,
      kind: 'agent',
      name: 'sub',
      parentPrincipalId: tree.agent.id,
    });

    const wider = issueMandate(handle.db, ring, {
      orgId: tree.org.id,
      subjectPrincipalId: sub.id,
      parentId: parent.id,
      issuerPrincipalId: tree.agent.id,
      scope: scope({ ...within(parent), models: ['anthropic/*'], budget: { limit: '100.00', period: 'day' } }),
    });
    await expect(wider).rejects.toMatchObject({ code: 'not_within_parent' });
    const error = (await wider.catch((e: unknown) => e)) as MandateError;
    expect(error.violations.join(' ')).toMatch(/models not granted by parent/);
    expect(error.violations.join(' ')).toMatch(/budget exceeds parent budget/);

    // Someone else's mandate can't be delegated from.
    const stranger = await createPrincipal(handle.db, { orgId: tree.org.id, kind: 'agent', name: 'stranger' });
    await expect(
      issueMandate(handle.db, ring, {
        orgId: tree.org.id,
        subjectPrincipalId: sub.id,
        parentId: parent.id,
        issuerPrincipalId: stranger.id,
        scope: scope({ ...within(parent), budget: { limit: '1.00', period: 'day' } }),
      }),
    ).rejects.toMatchObject({ code: 'not_within_parent' });

    let current = parent;
    let holder = tree.agent.id;
    for (let level = 1; level < 3; level += 1) {
      const next = await createPrincipal(handle.db, {
        orgId: tree.org.id,
        kind: 'agent',
        name: `level-${String(level)}`,
        parentPrincipalId: holder,
      });
      current = await issueMandate(handle.db, ring, {
        orgId: tree.org.id,
        subjectPrincipalId: next.id,
        parentId: current.id,
        issuerPrincipalId: holder,
        scope: scope({ ...within(current), budget: { limit: '1.00', period: 'day' } }),
      });
      holder = next.id;
    }
    const tooDeep = await createPrincipal(handle.db, { orgId: tree.org.id, kind: 'agent', name: 'too-deep' });
    await expect(
      issueMandate(handle.db, ring, {
        orgId: tree.org.id,
        subjectPrincipalId: tooDeep.id,
        parentId: current.id,
        issuerPrincipalId: holder,
        scope: scope({ ...within(current), budget: { limit: '0.50', period: 'day' } }),
      }),
    ).rejects.toMatchObject({ code: 'too_deep' });
  });

  it('count uses under a lock: two requests can’t both spend a one-use mandate (P6)', async () => {
    const tree = await seedTree(handle.db);
    const issuer = await user('issuer');
    const mandate = await issueMandate(handle.db, ring, {
      orgId: tree.org.id,
      subjectPrincipalId: tree.agent.id,
      scope: scope({ maxUses: 1 }),
      issuerUserId: issuer.id,
    });
    const attempt = () =>
      handle.db.transaction(async (tx) => {
        await consumeMandateUse(tx, mandate.id);
        return 'ok';
      });
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [row] = await handle.db.select().from(mandates).where(eq(mandates.id, mandate.id));
    expect(row?.uses).toBe(1);
  });

  it('put a mandate’s budget on the reserve path', async () => {
    const tree = await seedTree(handle.db);
    const issuer = await user('issuer');
    const mandate = await issueMandate(handle.db, ring, {
      orgId: tree.org.id,
      subjectPrincipalId: tree.agent.id,
      scope: scope({ budget: { limit: '0.50', period: 'none' } }),
      issuerUserId: issuer.id,
    });
    const over = await reserve(
      handle.db,
      reserveInput(tree.org.id, tree.agent.id, usd('0.60'), { mandateBudgetId: mandate.budgetId ?? '' }),
    );
    expect(over).toMatchObject({ ok: false, reason: 'budget_exceeded' });
    const fits = await reserve(
      handle.db,
      reserveInput(tree.org.id, tree.agent.id, usd('0.40'), { mandateBudgetId: mandate.budgetId ?? '' }),
    );
    expect(fits.ok).toBe(true);
  });

  it('revocation cascades to descendants, their sub-agents and their keys (P4)', async () => {
    const tree = await seedTree(handle.db);
    const issuer = await user('issuer');
    const root = await issueMandate(handle.db, ring, {
      orgId: tree.org.id,
      subjectPrincipalId: tree.agent.id,
      scope: scope(),
      issuerUserId: issuer.id,
    });
    const sub = await createPrincipal(handle.db, {
      orgId: tree.org.id,
      kind: 'agent',
      name: 'sub',
      parentPrincipalId: tree.agent.id,
    });
    await handle.db.insert(apiKeys).values({
      id: crypto.randomUUID(),
      orgId: tree.org.id,
      principalId: sub.id,
      name: 'k',
      prefix: 'apk_test_abc',
      hash: crypto.randomUUID(),
      createdBy: issuer.id,
    });
    const child = await issueMandate(handle.db, ring, {
      orgId: tree.org.id,
      subjectPrincipalId: sub.id,
      parentId: root.id,
      issuerPrincipalId: tree.agent.id,
      scope: scope({ ...within(root), budget: { limit: '1.00', period: 'day' } }),
    });

    expect(await revokeMandate(handle.db, { orgId: tree.org.id, mandateId: root.id })).toBe(2);
    const statuses = await handle.db
      .select({ id: mandates.id, status: mandates.status })
      .from(mandates)
      .where(eq(mandates.orgId, tree.org.id));
    expect(statuses.every((m) => m.status === 'revoked')).toBe(true);
    expect((await handle.db.select().from(principals).where(eq(principals.id, sub.id)))[0]?.status).toBe('revoked');
    expect((await handle.db.select().from(principals).where(eq(principals.id, tree.agent.id)))[0]?.status).toBe(
      'active',
    );
    expect(
      (await handle.db.select().from(apiKeys).where(eq(apiKeys.principalId, sub.id)))[0]?.revokedAt,
    ).not.toBeNull();
    await expect(handle.db.transaction((tx) => consumeMandateUse(tx, child.id))).rejects.toMatchObject({
      code: 'revoked',
    });
  });
});

describe('approvals', () => {
  it('enforce separation of duties and issue a one-shot mandate bound to the request (A1, A3)', async () => {
    const tree = await seedTree(handle.db);
    const owner = await user('agent-owner');
    const finance = await user('finance');
    await handle.db.update(principals).set({ ownerUserId: owner.id }).where(eq(principals.id, tree.agent.id));
    const approval = await requestApproval(handle.db, {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'gateway',
      resource: 'openrouter:anthropic/claude-sonnet-5',
      amount: usd('3'),
      purpose: 'long report',
      context: { route: '/v1/chat/completions' },
    });
    const again = await requestApproval(handle.db, {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'gateway',
      resource: 'openrouter:anthropic/claude-sonnet-5',
      amount: usd('2'),
      purpose: 'x',
      context: {},
    });
    expect(again.id).toBe(approval.id);

    await expect(
      decideApproval(handle.db, ring, {
        orgId: tree.org.id,
        approvalId: approval.id,
        deciderUserId: owner.id,
        approve: true,
      }),
    ).rejects.toMatchObject({ code: 'separation_of_duties' });
    const approved = await decideApproval(handle.db, ring, {
      orgId: tree.org.id,
      approvalId: approval.id,
      deciderUserId: finance.id,
      approve: true,
      amount: usd('2.5'),
    });
    expect(approved).toMatchObject({ status: 'approved', approvedAmount: usd('2.5') });
    const [oneShot] = await handle.db
      .select()
      .from(mandates)
      .where(eq(mandates.id, approved.mandateId ?? ''));
    expect(oneShot).toMatchObject({ maxUses: 1, subjectPrincipalId: tree.agent.id });
    expect(oneShot?.scope).toMatchObject({ models: ['anthropic/claude-sonnet-5'], maxPerAction: '2.50' });

    expect(
      await usableApproval(handle.db, {
        orgId: tree.org.id,
        approvalId: approval.id,
        principalId: tree.agent.id,
        rail: 'gateway',
        resource: 'openrouter:anthropic/claude-sonnet-5',
      }),
    ).toBeDefined();
    expect(
      await usableApproval(handle.db, {
        orgId: tree.org.id,
        approvalId: approval.id,
        principalId: tree.agent.id,
        rail: 'gateway',
        resource: 'openrouter:openai/gpt-5',
      }),
    ).toBeUndefined();
    await expect(
      decideApproval(handle.db, ring, {
        orgId: tree.org.id,
        approvalId: approval.id,
        deciderUserId: finance.id,
        approve: false,
      }),
    ).rejects.toMatchObject({ code: 'not_pending' });
  });

  it('expire when nobody decides in time', async () => {
    const tree = await seedTree(handle.db);
    const approval = await requestApproval(handle.db, {
      orgId: tree.org.id,
      principalId: tree.agent.id,
      rail: 'gateway',
      resource: 'openrouter:x/y',
      amount: usd('1'),
      purpose: 'x',
      context: {},
    });
    await handle.db
      .update(approvals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(approvals.id, approval.id));
    expect(await expireApprovals(handle.db)).toBeGreaterThanOrEqual(1);
    expect((await handle.db.select().from(approvals).where(eq(approvals.id, approval.id)))[0]?.status).toBe('expired');
  });
});
