import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, createHarness, signUp, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

interface Me {
  user: { email: string; emailVerified: boolean };
  memberships: { orgId: string; orgName: string; role: string }[];
}

describe('sign-up and organizations', () => {
  it('requires email verification before signing in', async () => {
    const response = await h.request('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'unverified@example.com', password: 'correct horse battery staple', name: 'U' }),
    });
    expect(response.status).toBe(200);
    const signIn = await h.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'unverified@example.com', password: 'correct horse battery staple' }),
    });
    expect(signIn.status).toBe(403);
  });

  it('signs up, verifies, creates an org as owner, and lists it on /me', async () => {
    const cookie = await signUp(h, 'owner@example.com', 'Olivia Owner');
    const created = await h.request('/api/v1/orgs', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Acme', timezone: 'Asia/Dubai' }),
    });
    expect(created.status).toBe(201);
    const org = await body<{ id: string; role: string }>(created);
    expect(org.role).toBe('owner');

    const me = await body<Me>(await h.request('/api/v1/me', { cookie }));
    expect(me.user).toMatchObject({ email: 'owner@example.com', emailVerified: true });
    expect(me.memberships).toEqual([{ orgId: org.id, orgName: 'Acme', role: 'owner', teamId: null }]);
  });

  it('rejects anonymous callers and cross-site writes', async () => {
    expect((await h.request('/api/v1/me')).status).toBe(401);
    const cookie = await signUp(h, 'csrf@example.com');
    const crossSite = await h.request('/api/v1/orgs', {
      method: 'POST',
      cookie,
      headers: { origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(crossSite.status).toBe(403);
  });
});
