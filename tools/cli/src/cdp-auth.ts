import { createPrivateKey, randomBytes, sign } from 'node:crypto';

/*
 * Coinbase Developer Platform API authentication: a short-lived JWT signed with the API key's
 * Ed25519 secret (base64 of the 64-byte seed+public key), bound to one method and path.
 * Used by the x402 spike to call CDP's facilitator.
 */

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export function cdpJwt(keyId: string, secret: string, method: string, url: string): string {
  const raw = Buffer.from(secret, 'base64');
  if (raw.length !== 64) throw new Error('CDP_API_KEY_SECRET must be an Ed25519 key (64 bytes, base64)');
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.subarray(0, 32)]);
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const { host, pathname } = new URL(url);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(
    JSON.stringify({ alg: 'EdDSA', kid: keyId, typ: 'JWT', nonce: randomBytes(16).toString('hex') }),
  );
  const payload = b64url(
    JSON.stringify({
      sub: keyId,
      iss: 'cdp',
      aud: ['cdp_service'],
      nbf: now,
      exp: now + 120,
      uri: `${method} ${host}${pathname}`,
    }),
  );
  return `${header}.${payload}.${b64url(sign(null, Buffer.from(`${header}.${payload}`), key))}`;
}

/** Headers for a facilitator call: CDP JWT when CDP_API_KEY_ID/SECRET are set and the URL is CDP's. */
export function facilitatorHeaders(method: string, url: string): Record<string, string> {
  const id = process.env.CDP_API_KEY_ID;
  const secret = process.env.CDP_API_KEY_SECRET;
  if (id === undefined || secret === undefined || !url.includes('api.cdp.coinbase.com')) return {};
  return { authorization: `Bearer ${cdpJwt(id, secret, method, url)}` };
}
