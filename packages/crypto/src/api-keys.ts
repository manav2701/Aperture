import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Aperture gateway keys: `apk_live_…` / `apk_test_…` followed by 32 random bytes in base62.
 * Only HMAC-SHA-256(pepper, key) is stored, so a database leak doesn't leak usable keys, and
 * the pepper lives outside the database (APERTURE_KEY_PEPPER).
 */

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const API_KEY_PREFIX_LENGTH = 12;
const API_KEY_PATTERN = /^apk_(live|test)_[0-9A-Za-z]{40,50}$/;

function base62(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString('hex')}`);
  let out = '';
  while (value > 0n) {
    out = (BASE62[Number(value % 62n)] ?? '') + out;
    value /= 62n;
  }
  // 32 bytes are at most 43 base62 digits; pad so every key has the same length.
  return out.padStart(43, '0');
}

export function generateApiKey(mode: 'live' | 'test'): { key: string; prefix: string } {
  const key = `apk_${mode}_${base62(randomBytes(32))}`;
  return { key, prefix: key.slice(0, API_KEY_PREFIX_LENGTH) };
}

/** Cheap shape check before touching the database with an attacker-supplied value. */
export const looksLikeApiKey = (value: string) => API_KEY_PATTERN.test(value);

export function hashApiKey(key: string, pepper: string): string {
  if (pepper.length < 32) throw new Error('the API key pepper must be at least 32 characters');
  return createHmac('sha256', pepper).update(key).digest('hex');
}

/*
 * Workspace tokens: the API mints a 5-minute token bound to one principal so the gateway can
 * serve the chat workspace without the browser ever holding a key. Format:
 * `wst.<base64url(json)>.<base64url(hmac)>`.
 */

export interface WorkspaceClaims {
  orgId: string;
  principalId: string;
  /** Unix seconds. */
  exp: number;
}

const sign = (payload: string, secret: string) =>
  createHmac('sha256', `workspace:${secret}`).update(payload).digest('base64url');

export function signWorkspaceToken(claims: WorkspaceClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `wst.${payload}.${sign(payload, secret)}`;
}

export function verifyWorkspaceToken(token: string, secret: string, now = Date.now()): WorkspaceClaims | undefined {
  const [kind, payload, signature] = token.split('.');
  if (kind !== 'wst' || payload === undefined || signature === undefined) return undefined;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<WorkspaceClaims>;
    if (typeof claims.orgId !== 'string' || typeof claims.principalId !== 'string' || typeof claims.exp !== 'number')
      return undefined;
    if (claims.exp * 1000 <= now) return undefined;
    return { orgId: claims.orgId, principalId: claims.principalId, exp: claims.exp };
  } catch {
    return undefined;
  }
}
