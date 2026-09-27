import { randomBytes } from 'node:crypto';
import { keyRingFromEnv } from '@aperture/crypto';
import { connect, decideApproval, eq, issueMandate, schema, sql, type DatabaseHandle } from '@aperture/db';
import { appRoleUrl, createTestDatabase, seedTree, usd } from '@aperture/db/testing';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyStripeEvent,
  authorizeCard,
  authorizationSchema,
  formEncode,
  minorUnitExponent,
  signStripePayload,
  spendingControls,
  stripeClient,
  toMicros,
  verifyStripeSignature,
} from '../src/index';
import { authorizationObject, stripeEvent, transactionObject } from './fake-stripe';

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

let cardSeq = 0;

/** An org with a Stripe connection and one agent card (no Stripe calls: rows only). */
async function setup(limits: { agent?: string } = {}) {
  const tree = await seedTree(system.db, {
    org: '100000',
    team: '100000',
    agent: limits.agent ?? '50',
    agentPeriod: 'month',
  });
  const connectionId = crypto.randomUUID();
  await system.db.insert(schema.connections).values({
    id: connectionId,
    orgId: tree.org.id,
    provider: 'stripe_issuing',
    name: 'Stripe Issuing',
    secret: {},
    config: { cardholderId: 'ich_test' },
  });
  const addCard = async (extra: Partial<typeof schema.cards.$inferInsert> = {}) => {
    const externalId = `ic_test${String((cardSeq += 1))}`;
    const [card] = await system.db
      .insert(schema.cards)
      .values({
        id: crypto.randomUUID(),
        orgId: tree.org.id,
        connectionId,
        principalId: tree.agent.id,
        externalId,
        kind: 'agent',
        ...extra,
      })
      .returning();
    if (!card) throw new Error('card insert failed');
    return card;
  };
  const card = await addCard();
  const decide = (object: ReturnType<typeof authorizationObject>) =>
    authorizeCard(app.db, { orgId: tree.org.id, connectionId, authorization: authorizationSchema.parse(object) });
  const apply = (event: ReturnType<typeof stripeEvent>) =>
    applyStripeEvent(app.db, { orgId: tree.org.id, connectionId, event });
  const spent = async () => {
    const rows = await system.db
      .select()
      .from(schema.budgetUsage)
      .where(eq(schema.budgetUsage.budgetId, tree.agentBudget.id));
    return rows.reduce((sum, row) => ({ spent: sum.spent + row.spent, held: sum.held + row.held }), {
      spent: 0n,
      held: 0n,
    });
  };
  const policy = async (rules: unknown[]) => {
    const [user] = await system.db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        name: 'Admin',
        email: `${crypto.randomUUID()}@example.com`,
        emailVerified: true,
      })
      .returning();
    await system.db.insert(schema.policies).values({
      id: crypto.randomUUID(),
      orgId: tree.org.id,
      scope: 'org',
      scopeId: tree.org.id,
      version: 1,
      document: { rules },
      createdBy: user?.id ?? '',
    });
    return user?.id ?? '';
  };
  return { ...tree, connectionId, card, addCard, decide, apply, spent, policy };
}

describe('Stripe plumbing (pure)', () => {
  it('verifies Stripe-Signature over the raw body, within five minutes, with rolled secrets', () => {
    const body = '{"id":"evt_1"}';
    const header = signStripePayload('whsec_a', body);
    expect(verifyStripeSignature('whsec_a', header, body)).toBe(true);
    expect(verifyStripeSignature('whsec_a', header, `${body} `)).toBe(false);
    expect(verifyStripeSignature('whsec_b', header, body)).toBe(false);
    expect(verifyStripeSignature('whsec_a', header, body, Date.now() + 6 * 60_000)).toBe(false);
    const rolled = `${header},v1=${'0'.repeat(64)}`;
    expect(verifyStripeSignature('whsec_a', rolled, body)).toBe(true);
    fc.assert(
      fc.property(fc.string(), (garbage) => {
        expect(verifyStripeSignature('whsec_a', garbage, body)).toBe(false);
      }),
    );
  });

  it('converts minor units to µUSD, rounding holds up (K10)', () => {
    expect(toMicros(1250n, 'usd', 1_000_000n)).toBe(12_500_000n);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(toMicros(1000n, 'jpy', 6_700n)).toBe(6_700_000n); // ¥1,000 at $0.0067
    expect(toMicros(1000n, 'kwd', 3_250_000n)).toBe(3_250_000n); // 1.000 KWD
    expect(toMicros(1n, 'aed', 272_294n)).toBe(2_723n); // 0.01 AED rounds up
  });

  it('refuses to ever ask Stripe for a card number (K13)', async () => {
    const client = stripeClient('rk_test_x', () => Promise.reject(new Error('must not be called')));
    await expect(client.request('GET', '/v1/issuing/cards/ic_1', { expand: ['number'] })).rejects.toThrow(/K13/);
  });

  it('form-encodes nested params and builds the spending_controls backstop', () => {
    expect(decodeURIComponent(formEncode({ a: { b: [{ c: 1 }] }, d: true }))).toBe('a[b][0][c]=1&d=true');
    expect(
      spendingControls({ perAuthorization: usd('25'), monthly: usd('100'), categories: ['computer_software_stores'] }),
    ).toEqual({
      spending_limits: [
        { amount: 2500, interval: 'per_authorization' },
        { amount: 11000, interval: 'monthly' },
      ],
      allowed_categories: ['computer_software_stores'],
    });
  });
});

describe('real-time authorization (K1, K4, K16)', () => {
  it('approves within policy and budget and holds the amount; declines outside it', async () => {
    const org = await setup({ agent: '20' });
    await org.policy([
      { id: 'cats', type: 'merchant_categories', allow: ['computer_software_stores'] },
      { id: 'uae-us', type: 'merchant_countries', allow: ['US', 'AE'] },
    ]);
    const ok = await org.decide(authorizationObject({ card: org.card.externalId, amount: 1250 }));
    expect(ok).toMatchObject({ approved: true, amountMicros: usd('12.5') });
    expect((await org.spent()).held).toBe(usd('12.5'));

    const category = await org.decide(
      authorizationObject({ card: org.card.externalId, amount: 100, category: 'bars' }),
    );
    expect(category).toMatchObject({ approved: false, code: 'merchant_category_not_allowed' });
    const country = await org.decide(authorizationObject({ card: org.card.externalId, amount: 100, country: 'RU' }));
    expect(country).toMatchObject({ approved: false, code: 'merchant_country_not_allowed' });
    const budget = await org.decide(authorizationObject({ card: org.card.externalId, amount: 1000 }));
    expect(budget).toMatchObject({ approved: false, code: 'budget_exceeded' });
    const unknown = await org.decide(authorizationObject({ card: 'ic_notours', amount: 100 }));
    expect(unknown).toMatchObject({ approved: false, code: 'unknown_card' });
    const eur = await org.decide(authorizationObject({ card: org.card.externalId, amount: 100, currency: 'eur' }));
    expect(eur).toMatchObject({ approved: false, code: 'fx_unavailable' });

    const decisions = await system.db
      .select()
      .from(schema.cardAuthorizations)
      .where(eq(schema.cardAuthorizations.orgId, org.org.id));
    expect(decisions.map((row) => row.decision).sort()).toEqual([
      'approved',
      'declined',
      'declined',
      'declined',
      'declined',
    ]);
    const audit = await system.db.execute<{ n: string }>(
      sql`select count(*) as n from audit_events where org_id = ${org.org.id} and action like 'card.authorization.%'`,
    );
    expect(Number(audit.rows[0]?.n)).toBe(6);
  });

  it('holds each incremental authorization separately, and a replay is the same decision', async () => {
    const org = await setup();
    const auth = authorizationObject({ card: org.card.externalId, amount: 1000 });
    const first = await org.decide(auth);
    expect((await org.decide(auth)).holdId).toBe(first.holdId);
    const increment = {
      ...auth,
      amount: 1000,
      pending_request: { amount: 500, currency: 'usd', is_amount_controllable: false },
      request_history: [{ approved: true }],
    };
    const second = await org.decide(increment);
    expect(second.approved).toBe(true);
    expect(second.holdId).not.toBe(first.holdId);
    expect((await org.spent()).held).toBe(usd('15'));
  });

  it('frozen cards and expired task cards are declined', async () => {
    const org = await setup();
    const frozen = await org.addCard({ status: 'inactive' });
    expect(await org.decide(authorizationObject({ card: frozen.externalId, amount: 100 }))).toMatchObject({
      code: 'card_inactive',
    });
    const stale = await org.addCard({ kind: 'task', expiresAt: new Date(Date.now() - 1000) });
    expect(await org.decide(authorizationObject({ card: stale.externalId, amount: 100 }))).toMatchObject({
      code: 'card_expired',
    });
  });

  it('over the approval threshold: declined with an approval; approving yields a one-shot task card that works once', async () => {
    const org = await setup({ agent: '1000' });
    const author = await org.policy([{ id: 'ask', type: 'approval_threshold', rail: 'card', above: '100' }]);
    const big = await org.decide(authorizationObject({ card: org.card.externalId, amount: 60000 }));
    expect(big).toMatchObject({ approved: false, code: 'approval_required' });
    expect(big.approvalId).not.toBeNull();

    const approval = await decideApproval(system.db, ring, {
      orgId: org.org.id,
      approvalId: big.approvalId ?? '',
      deciderUserId: author,
      approve: true,
    });
    const task = await org.addCard({
      kind: 'task',
      approvalId: approval.id,
      mandateId: approval.mandateId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const onTask = await org.decide(authorizationObject({ card: task.externalId, amount: 60000 }));
    expect(onTask).toMatchObject({ approved: true });
    const again = await org.decide(authorizationObject({ card: task.externalId, amount: 100 }));
    expect(again.approved).toBe(false);
    const [used] = await system.db.select().from(schema.approvals).where(eq(schema.approvals.id, approval.id));
    expect(used?.status).toBe('used');
  });

  it('a standing mandate without the card rail blocks card spend', async () => {
    const org = await setup();
    await issueMandate(system.db, ring, {
      orgId: org.org.id,
      subjectPrincipalId: org.agent.id,
      scope: {
        rails: ['gateway'],
        budget: { limit: '5', period: 'day' },
        notBefore: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        purpose: 'models only',
      },
    });
    expect(await org.decide(authorizationObject({ card: org.card.externalId, amount: 100 }))).toMatchObject({
      approved: false,
      code: 'rail_not_allowed',
    });
  });
});

describe('event state machine (K2–K11, INV-11)', () => {
  it('captures settle when the authorization closes; late captures, force captures and refunds are counted', async () => {
    const org = await setup();
    const auth = authorizationObject({ card: org.card.externalId, amount: 2000 });
    await org.decide(auth);
    const created = stripeEvent('issuing_authorization.created', { ...auth, pending_request: null });
    expect(await org.apply(created)).toEqual({ status: 'applied' });
    expect(await org.apply(created)).toEqual({ status: 'duplicate' });

    // Captured for less than authorized, then closed: spend is what was captured.
    await org.apply(
      stripeEvent(
        'issuing_transaction.created',
        transactionObject({ card: org.card.externalId, authorization: auth.id, amount: 1800 }),
      ),
    );
    expect(await org.spent()).toEqual({ spent: 0n, held: usd('20') });
    await org.apply(
      stripeEvent('issuing_authorization.updated', { ...auth, status: 'closed', amount: 0, pending_request: null }),
    );
    expect(await org.spent()).toEqual({ spent: usd('18'), held: 0n });

    // A capture after close (K11) and a refund (L13).
    await org.apply(
      stripeEvent(
        'issuing_transaction.created',
        transactionObject({ card: org.card.externalId, authorization: auth.id, amount: 300 }),
      ),
    );
    expect((await org.spent()).spent).toBe(usd('21'));
    await org.apply(
      stripeEvent(
        'issuing_transaction.created',
        transactionObject({ card: org.card.externalId, authorization: auth.id, type: 'refund', amount: 500 }),
      ),
    );
    expect((await org.spent()).spent).toBe(usd('16'));

    // A force capture on a task card (K7, K8): counted, alerted, and the card is frozen.
    const task = await org.addCard({ kind: 'task' });
    const forced = await org.apply(
      stripeEvent('issuing_transaction.created', transactionObject({ card: task.externalId, amount: 500 })),
    );
    expect(forced).toEqual({ status: 'applied', freezeCard: task.externalId });
    expect((await org.spent()).spent).toBe(usd('21'));
    const alerts = await system.db.select().from(schema.alertLog).where(eq(schema.alertLog.orgId, org.org.id));
    expect(alerts.map((a) => a.kind)).toContain('card_unheld_capture');
  });

  it('an authorization Stripe approved without us is alerted, and its captures still count (K2)', async () => {
    const org = await setup();
    const auth = authorizationObject({
      card: org.card.externalId,
      amount: 700,
      status: 'closed',
      pending: null,
      history: [{ approved: true, reason: 'webhook_timeout' }],
    });
    await org.apply(
      stripeEvent(
        'issuing_transaction.created',
        transactionObject({ card: org.card.externalId, authorization: auth.id, amount: 700 }),
      ),
    );
    await org.apply(stripeEvent('issuing_authorization.created', auth));
    expect((await org.spent()).spent).toBe(usd('7'));
    const alerts = await system.db.select().from(schema.alertLog).where(eq(schema.alertLog.orgId, org.org.id));
    expect(alerts.find((a) => a.kind === 'card_unseen_authorization')?.payload).toMatchObject({
      reason: 'webhook_timeout',
    });
  });

  it('INV-11: any order and duplication of a lifecycle converges to the same spend', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 900 }), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 0, max: 400 }),
        fc.boolean(),
        fc.infiniteStream(fc.nat()),
        async (captures, refunded, withRefund, randomness) => {
          const org = await setup();
          const total = captures.reduce((a, b) => a + b, 0);
          const auth = authorizationObject({ card: org.card.externalId, amount: total + 100 });
          expect((await org.decide(auth)).approved).toBe(true);
          const events = [
            stripeEvent('issuing_authorization.created', { ...auth, pending_request: null }),
            ...captures.map((amount) =>
              stripeEvent(
                'issuing_transaction.created',
                transactionObject({ card: org.card.externalId, authorization: auth.id, amount }),
              ),
            ),
            stripeEvent('issuing_authorization.updated', { ...auth, status: 'closed', pending_request: null }),
          ];
          const refund = Math.min(refunded, total);
          if (withRefund && refund > 0) {
            events.push(
              stripeEvent(
                'issuing_transaction.created',
                transactionObject({
                  card: org.card.externalId,
                  authorization: auth.id,
                  type: 'refund',
                  amount: refund,
                }),
              ),
            );
          }
          // Shuffle, and deliver some events twice.
          const iterator = randomness[Symbol.iterator]();
          const delivered = [...events, ...events.filter(() => (iterator.next().value as number) % 3 === 0)];
          for (let i = delivered.length - 1; i > 0; i -= 1) {
            const j = (iterator.next().value as number) % (i + 1);
            const a = delivered[i];
            const b = delivered[j];
            if (a !== undefined && b !== undefined) {
              delivered[i] = b;
              delivered[j] = a;
            }
          }
          for (const event of delivered) await org.apply(event);
          const expected = usd(((total - (withRefund ? refund : 0)) / 100).toFixed(2));
          expect(await org.spent()).toEqual({ spent: expected, held: 0n });
        },
      ),
      { numRuns: Number(process.env.PROPERTY_RUNS ?? 15) },
    );
  });
});
