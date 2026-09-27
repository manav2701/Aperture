import { signStripePayload } from '@aperture/cards';
import { authorizationObject, stripeEvent, transactionObject } from '@aperture/cards/testing';
import { json } from '@aperture/connectors/testing';
import { eq, schema } from '@aperture/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, createHarness, createOrg, joinAs, signUp, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

let counter = 0;
const email = (label: string) => `${label}-cards-${String((counter += 1))}@example.com`;
const post = (path: string, cookie: string, payload: unknown = {}) =>
  h.request(path, { method: 'POST', cookie, body: JSON.stringify(payload) });

/** Shaped like a Stripe test restricted key; assembled so scanners don't mistake it for one. */
const FAKE_RESTRICTED_KEY = ['rk', 'test', 'fixture'].join('_');
const AUTH_SECRET = 'whsec_authtest';
const EVENTS_SECRET = 'whsec_eventstest';

/** Stripe as the fake provider: cardholder and card creation, and status updates. */
function fakeStripe() {
  let cards = 0;
  return h.provider({
    'GET /v1/issuing/cardholders': json({ object: 'list', data: [], livemode: false }),
    'POST /v1/issuing/cardholders': json({ id: 'ich_company', type: 'company' }),
    'POST /v1/issuing/cards': () => {
      cards += 1;
      return Response.json({ id: `ic_fake${String(cards)}`, last4: `424${String(cards)}`, currency: 'usd' });
    },
    'POST /v1/issuing/cards/ic_fake1': json({ id: 'ic_fake1', status: 'inactive' }),
  });
}

async function webhook(path: string, secret: string, payload: unknown) {
  const raw = JSON.stringify(payload);
  return h.request(path, {
    method: 'POST',
    headers: { 'stripe-signature': signStripePayload(secret, raw), 'content-type': 'application/json' },
    body: raw,
  });
}

describe('cards rail (Phase 8)', () => {
  it('connect → card → real-time decisions → capture → approval → single-use task card', async () => {
    const owner = await signUp(h, email('owner'));
    const orgId = await createOrg(h, owner);
    const base = `/api/v1/orgs/${orgId}`;
    await post(`${base}/budgets`, owner, { name: 'Company', scope: 'org', period: 'month', limit: '5000' });
    const calls = fakeStripe();

    const connected = await h.request(`${base}/cards/stripe`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({
        apiKey: FAKE_RESTRICTED_KEY,
        authorizationSecret: AUTH_SECRET,
        eventsSecret: EVENTS_SECRET,
        company: {
          name: 'Acme FZ-LLC',
          line1: '1 Main St',
          city: 'Wilmington',
          postalCode: '19801',
          country: 'US',
          state: 'DE',
        },
      }),
    });
    expect(connected.status).toBe(200);
    const { connectionId, authorizationUrl } = await body<{ connectionId: string; authorizationUrl: string }>(
      connected,
    );
    expect(authorizationUrl).toMatch(new RegExp(`/webhooks/stripe/${connectionId}/authorization$`));
    expect(calls.every((call) => !call.url.toString().includes('number'))).toBe(true);

    const agent = await body<{ id: string }>(
      await post(`${base}/agents`, owner, { name: 'buyer', budget: { limit: '1000', period: 'month' } }),
    );
    await h.request(`${base}/policies/org/${orgId}`, {
      method: 'PUT',
      cookie: owner,
      body: JSON.stringify({
        document: { rules: [{ id: 'big', type: 'approval_threshold', rail: 'card', above: '100' }] },
      }),
    });
    const issued = await post(`${base}/agents/${agent.id}/cards`, owner, {
      purpose: 'software',
      monthly: '50',
      categories: ['computer_software_stores'],
    });
    expect(issued.status).toBe(201);
    const card = await body<{ id: string; last4: string }>(issued);
    const sent = calls.find((call) => call.url.pathname === '/v1/issuing/cards');
    expect(String(sent?.body)).toContain('spending_controls');
    expect(String(sent?.body)).not.toContain('expand');

    // Real-time: signed, decided, answered with the hold id.
    const auth = authorizationObject({ card: 'ic_fake1', amount: 1250 });
    const request = stripeEvent('issuing_authorization.request', auth);
    const forged = await h.request(`/webhooks/stripe/${connectionId}/authorization`, {
      method: 'POST',
      headers: { 'stripe-signature': signStripePayload('whsec_wrong', JSON.stringify(request)) },
      body: JSON.stringify(request),
    });
    expect(forged.status).toBe(400);
    const ok = await webhook(`/webhooks/stripe/${connectionId}/authorization`, AUTH_SECRET, request);
    expect(ok.headers.get('stripe-version')).toBeTruthy();
    expect(await body(ok)).toMatchObject({ approved: true, metadata: { aperture_reason: 'approved' } });

    // Events: capture and close settle the hold.
    const events = `/webhooks/stripe/${connectionId}/events`;
    expect(
      (
        await webhook(
          events,
          EVENTS_SECRET,
          stripeEvent('issuing_authorization.created', { ...auth, pending_request: null }),
        )
      ).status,
    ).toBe(200);
    await webhook(
      events,
      EVENTS_SECRET,
      stripeEvent(
        'issuing_transaction.created',
        transactionObject({ card: 'ic_fake1', authorization: auth.id, amount: 1250 }),
      ),
    );
    await webhook(
      events,
      EVENTS_SECRET,
      stripeEvent('issuing_authorization.updated', { ...auth, status: 'closed', pending_request: null }),
    );
    const spend = await body<{ total: string }>(await h.request(`${base}/spend`, { cookie: owner }));
    expect(spend.total).toBe('12.50');

    // Over the threshold: declined, approval opened; finance approves → a single-use card.
    const big = authorizationObject({ card: 'ic_fake1', amount: 60000 });
    const declined = await body<{ approved: boolean; metadata: { aperture_approval_id: string } }>(
      await webhook(
        `/webhooks/stripe/${connectionId}/authorization`,
        AUTH_SECRET,
        stripeEvent('issuing_authorization.request', big),
      ),
    );
    expect(declined.approved).toBe(false);
    const finance = await joinAs(h, { ownerCookie: owner, orgId, email: email('finance'), role: 'finance' });
    const approved = await body<{ status: string; taskCardId: string | null }>(
      await post(`${base}/approvals/${declined.metadata.aperture_approval_id}/approve`, finance, {}),
    );
    expect(approved.status).toBe('approved');
    expect(approved.taskCardId).not.toBeNull();
    const cards = await body<{ cards: { id: string; kind: string; controls: { spending_limits?: unknown[] } }[] }>(
      await h.request(`${base}/cards?principalId=${agent.id}`, { cookie: owner }),
    );
    const task = cards.cards.find((c) => c.kind === 'task');
    expect(task?.controls.spending_limits).toEqual([{ amount: 60000, interval: 'per_authorization' }]);
    const taskCall = calls.filter((call) => call.url.pathname === '/v1/issuing/cards').at(-1);
    expect(String(taskCall?.body)).toContain('lifecycle_controls');

    const onTask = await webhook(
      `/webhooks/stripe/${connectionId}/authorization`,
      AUTH_SECRET,
      stripeEvent('issuing_authorization.request', authorizationObject({ card: 'ic_fake2', amount: 60000 })),
    );
    expect(await body(onTask)).toMatchObject({ approved: true });

    // Freeze through the dashboard: Stripe first, then Aperture; frozen cards are declined.
    const frozen = await post(`${base}/cards/${card.id}/status`, owner, { status: 'inactive' });
    expect(await body(frozen)).toMatchObject({ status: 'inactive' });
    const after = await webhook(
      `/webhooks/stripe/${connectionId}/authorization`,
      AUTH_SECRET,
      stripeEvent('issuing_authorization.request', authorizationObject({ card: 'ic_fake1', amount: 100 })),
    );
    expect(await body(after)).toMatchObject({ approved: false, metadata: { aperture_reason: 'card_inactive' } });

    const history = await body<{ authorizations: { decision: string }[] }>(
      await h.request(`${base}/cards/${card.id}/authorizations`, { cookie: owner }),
    );
    expect(history.authorizations.map((a) => a.decision).sort()).toEqual(['approved', 'declined', 'declined']);
    const [row] = await h.system.db.select().from(schema.cards).where(eq(schema.cards.id, card.id));
    expect(row?.status).toBe('inactive');
  });

  it('webhooks for unknown connections are refused and nothing is approved', async () => {
    const response = await webhook(
      `/webhooks/stripe/${crypto.randomUUID()}/authorization`,
      AUTH_SECRET,
      stripeEvent('issuing_authorization.request', authorizationObject({ card: 'ic_x', amount: 100 })),
    );
    expect(response.status).toBe(404);
  });
});
