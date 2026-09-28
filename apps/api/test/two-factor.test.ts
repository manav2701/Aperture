import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, createHarness, createOrg, signUp, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ enforceTwoFactor: true });
});
afterAll(async () => {
  await h.close();
});

const PASSWORD = 'correct horse battery staple';

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from an otpauth:// URI, like an authenticator app. */
function totp(uri: string, at = Date.now()): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('two-factor (Phase 10)', () => {
  it('owners change nothing until two-factor is on; then sign-in needs the code', async () => {
    const email = 'owner-2fa@example.com';
    let cookie = await signUp(h, email);
    const orgId = await createOrg(h, cookie);
    const base = `/api/v1/orgs/${orgId}`;

    // Reads work; writes are refused with a clear code.
    expect((await h.request(base, { cookie })).status).toBe(200);
    const blocked = await h.request(`${base}/teams`, { method: 'POST', cookie, body: JSON.stringify({ name: 'Ops' }) });
    expect(blocked.status).toBe(403);
    expect(await body(blocked)).toMatchObject({ error: { code: 'two_factor_required' } });

    // Enable: the authenticator gets a TOTP URI; confirming a code turns it on.
    const enabled = await h.request('/api/auth/two-factor/enable', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(enabled.status).toBe(200);
    const { totpURI, backupCodes } = await body<{ totpURI: string; backupCodes: string[] }>(enabled);
    expect(backupCodes.length).toBeGreaterThan(5);
    const confirmed = await h.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ code: totp(totpURI) }),
    });
    expect(confirmed.status).toBe(200);
    const refreshed = cookiesOf(confirmed);
    if (refreshed.includes('session_token')) cookie = refreshed;

    expect(
      (await h.request(`${base}/teams`, { method: 'POST', cookie, body: JSON.stringify({ name: 'Ops' }) })).status,
    ).toBe(201);

    // Password sign-in now stops at the second factor.
    const first = await h.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(await body(first)).toMatchObject({ twoFactorRedirect: true });
    expect(cookiesOf(first)).not.toMatch(/session_token=[^;]/);
    const second = await h.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      cookie: cookiesOf(first),
      body: JSON.stringify({ code: totp(totpURI) }),
    });
    expect(second.status).toBe(200);
    expect(cookiesOf(second)).toContain('session_token');

    // A magic link can't be used to skip the second factor.
    await h.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email, callbackURL: '/app' }),
    });
    const link = new URL(h.outbox.linkFor(email));
    const viaLink = await h.request(`${link.pathname}${link.search}`, { redirect: 'manual' });
    expect(cookiesOf(viaLink)).not.toMatch(/session_token=[^;]/);
  });
});
