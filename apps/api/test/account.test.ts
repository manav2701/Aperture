import { signStripePayload } from '@aperture/cards';
import { json } from '@aperture/connectors/testing';
import { eq, schema } from '@aperture/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, createHarness, createOrg, joinAs, signUp, type Harness } from './harness';

const WEBHOOK_SECRET = 'whsec_billingtest';
const billing = {
  secretKey: 'sk_test_billing',
  webhookSecret: WEBHOOK_SECRET,
  prices: { team: 'price_team', business: 'price_business' },
};

let h: Harness;
let billed: Harness;
beforeAll(async () => {
  [h, billed] = await Promise.all([createHarness(), createHarness({ billing })]);
});
afterAll(async () => {
  await Promise.all([h.close(), billed.close()]);
});

let counter = 0;
const email = (label: string) => `${label}-account-${String((counter += 1))}@example.com`;

describe('privacy controls (Phase 10)', () => {
  it('sets retention, exports without secrets, and lets only the owner request (and cancel) deletion', async () => {
    const owner = await signUp(h, email('owner'));
    const orgId = await createOrg(h, owner, 'Acme Privacy');
    const base = `/api/v1/orgs/${orgId}`;
    const post = (path: string, cookie: string, payload: unknown = {}) =>
      h.request(path, { method: 'POST', cookie, body: JSON.stringify(payload) });

    expect(await body(await h.request(`${base}/settings/privacy`, { cookie: owner }))).toMatchObject({
      requestLogDays: 90,
      deletion: 'none',
    });
    const saved = await h.request(`${base}/settings/privacy`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({ requestLogDays: 30, mediaDays: 14 }),
    });
    expect(await body(saved)).toMatchObject({ requestLogDays: 30, mediaDays: 14 });
    const tooShort = await h.request(`${base}/settings/privacy`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({ requestLogDays: 1, mediaDays: 14 }),
    });
    expect(tooShort.status).toBe(400);

    h.provider({
      'GET /api/v1/key': json({ data: { is_management_key: true, organization_id: 'or-org-1' } }),
      'GET /api/v1/keys': json({ data: [] }),
    });
    expect(
      (await post(`${base}/connections`, owner, { provider: 'openrouter', secret: 'sk-or-v1-supersecret' })).status,
    ).toBe(201);
    const exported = await h.request(`${base}/export`, { cookie: owner });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    const text = await exported.text();
    expect(text).toContain('Acme Privacy');
    expect(text).not.toContain('supersecret');

    const admin = await joinAs(h, { ownerCookie: owner, orgId, email: email('admin'), role: 'admin' });
    expect((await post(`${base}/deletion`, admin, { confirmName: 'Acme Privacy' })).status).toBe(403);
    expect((await post(`${base}/deletion`, owner, { confirmName: 'acme' })).status).toBe(400);
    expect(await body(await post(`${base}/deletion`, owner, { confirmName: 'Acme Privacy' }))).toMatchObject({
      deletion: 'requested',
    });
    const cancelled = await h.request(`${base}/deletion`, { method: 'DELETE', cookie: owner });
    expect(await body(cancelled)).toMatchObject({ deletion: 'none' });

    const onboarding = await body<{ steps: { id: string; done: boolean }[] }>(
      await h.request(`${base}/onboarding`, { cookie: owner }),
    );
    expect(Object.fromEntries(onboarding.steps.map((step) => [step.id, step.done]))).toEqual({
      connect: true,
      teams: false,
      budgets: false,
      members: true,
      agent: false,
    });
    // Without Aperture billing (self-hosted), nothing is limited.
    expect(await body(await h.request(`${base}/billing`, { cookie: owner }))).toMatchObject({
      enabled: false,
      limits: { agents: null },
    });
  });
});

describe('billing (Phase 10)', () => {
  it('limits the free plan, upgrades through Checkout and the webhook, and ignores forged webhooks', async () => {
    const owner = await signUp(billed, email('owner'));
    const orgId = await createOrg(billed, owner);
    const base = `/api/v1/orgs/${orgId}`;
    const post = (path: string, payload: unknown = {}) =>
      billed.request(path, { method: 'POST', cookie: owner, body: JSON.stringify(payload) });

    expect(await body(await billed.request(`${base}/billing`, { cookie: owner }))).toMatchObject({
      enabled: true,
      plan: 'free',
      limits: { agents: 2 },
    });
    expect((await post(`${base}/agents`, { name: 'one' })).status).toBe(201);
    expect((await post(`${base}/agents`, { name: 'two' })).status).toBe(201);
    const third = await post(`${base}/agents`, { name: 'three' });
    expect(third.status).toBe(402);
    expect(await body(third)).toMatchObject({ error: { code: 'plan_limit' } });

    const calls = billed.provider({
      'POST /v1/customers': json({ id: 'cus_123' }),
      'POST /v1/checkout/sessions': json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
    });
    const checkout = await body<{ url: string }>(await post(`${base}/billing/checkout`, { plan: 'team' }));
    expect(checkout.url).toContain('checkout.stripe.com');
    expect(String(calls.find((call) => call.url.pathname === '/v1/checkout/sessions')?.body)).toContain('price_team');

    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
    const event = JSON.stringify({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_123',
          status: 'active',
          // Current API versions carry the period on the item, as the real sandbox sent it.
          items: { data: [{ price: { id: 'price_team' }, current_period_end: periodEnd }] },
        },
      },
    });
    const forged = await billed.request('/webhooks/stripe-billing', {
      method: 'POST',
      headers: { 'stripe-signature': signStripePayload('whsec_wrong', event) },
      body: event,
    });
    expect(forged.status).toBe(400);
    const genuine = await billed.request('/webhooks/stripe-billing', {
      method: 'POST',
      headers: { 'stripe-signature': signStripePayload(WEBHOOK_SECRET, event) },
      body: event,
    });
    expect(genuine.status).toBe(200);
    const [row] = await billed.system.db.select().from(schema.orgBilling).where(eq(schema.orgBilling.orgId, orgId));
    expect(row).toMatchObject({ plan: 'team', status: 'active', stripeSubscriptionId: 'sub_1' });
    expect(row?.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
    expect((await post(`${base}/agents`, { name: 'three' })).status).toBe(201);
  });
});
