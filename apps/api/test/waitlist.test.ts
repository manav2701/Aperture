import { eq, schema } from '@aperture/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

/** The private beta: only this address may get in; everyone else is pointed at the waitlist. */
const OPERATOR = 'operator@example.com';
const PASSWORD = 'correct horse battery staple';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ allowedEmails: [OPERATOR], clientIpHeader: 'cf-connecting-ip' });
});
afterAll(async () => {
  await h.close();
});

const join = (entry: Record<string, unknown>, ip = '198.51.100.1') =>
  h.request('/api/v1/public/waitlist', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
    body: JSON.stringify(entry),
  });

const stored = (email: string) =>
  h.system.db.select().from(schema.waitlistSignups).where(eq(schema.waitlistSignups.email, email));

describe('waitlist', () => {
  it('stores an entry from an anonymous caller', async () => {
    const response = await join({
      name: 'Ada Lovelace',
      email: 'Ada@Example.com',
      company: 'Analytical Engines',
      teamSize: '11_50',
      note: 'Six teams on three OpenAI accounts and nobody owns the bill.',
      referrer: 'launch-post',
    });
    expect(response.status).toBe(202);

    // The address is lower-cased on the way in, so it cannot join twice under another spelling.
    const [entry] = await stored('ada@example.com');
    expect(entry).toMatchObject({
      name: 'Ada Lovelace',
      company: 'Analytical Engines',
      teamSize: '11_50',
      referrer: 'launch-post',
      invitedAt: null,
    });
  });

  it('accepts a repeat submission without overwriting the first answers', async () => {
    const response = await join({ name: 'Ada Again', email: 'ADA@example.com', company: 'Somewhere else' });
    expect(response.status).toBe(202);
    const entries = await stored('ada@example.com');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'Ada Lovelace', company: 'Analytical Engines' });
  });

  it('rejects an address that is not an address, and a team size it does not know', async () => {
    expect((await join({ name: 'A', email: 'not-an-address' })).status).toBe(400);
    expect((await join({ name: 'A', email: 'a@example.com', teamSize: 'enormous' })).status).toBe(400);
  });

  it('caps one IP, and leaves other callers alone', async () => {
    const ip = '198.51.100.9';
    for (let i = 0; i < 10; i += 1) {
      expect((await join({ name: `Person ${String(i)}`, email: `person${String(i)}@example.com` }, ip)).status).toBe(
        202,
      );
    }
    expect((await join({ name: 'Eleven', email: 'eleven@example.com' }, ip)).status).toBe(429);
    expect((await join({ name: 'Elsewhere', email: 'elsewhere@example.com' }, '203.0.113.7')).status).toBe(202);
  });

  it('refuses a cross-site submission like every other write', async () => {
    const response = await h.request('/api/v1/public/waitlist', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'A', email: 'csrf@example.com' }),
    });
    expect(response.status).toBe(403);
  });
});

describe('private beta', () => {
  it('turns away a sign-up that is not on the allowlist, and creates no account', async () => {
    const response = await h.request('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'stranger@example.com', password: PASSWORD, name: 'Stranger' }),
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('/waitlist');
    const users = await h.system.db.select().from(schema.users).where(eq(schema.users.email, 'stranger@example.com'));
    expect(users).toHaveLength(0);
  });

  it('lets the allowlisted address sign up, verify and sign in', async () => {
    const signedUp = await h.request('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email: OPERATOR, password: PASSWORD, name: 'The Operator' }),
    });
    expect(signedUp.status).toBe(200);
    const link = new URL(h.outbox.linkFor(OPERATOR));
    await h.request(`${link.pathname}${link.search}`, { redirect: 'manual' });
    const signedIn = await h.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: OPERATOR, password: PASSWORD }),
    });
    expect(signedIn.status).toBe(200);
  });

  it('sends no magic link to an off-list address, even when the account exists', async () => {
    // An account can predate the gate, or be taken off the list later. Endpoints that carry an
    // address are refused here; the OAuth callback carries none, and the session hook covers it.
    await h.system.db.insert(schema.users).values({
      id: 'former-tester',
      name: 'Former Tester',
      email: 'former@example.com',
      emailVerified: true,
    });
    const magicLink = await h.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email: 'former@example.com' }),
    });
    expect(magicLink.status).toBe(403);
    expect(() => h.outbox.linkFor('former@example.com')).toThrow();
  });
});
