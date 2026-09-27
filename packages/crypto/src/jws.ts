import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';

/** A JSON Web Key as found in a JWKS (only the fields Ed25519 verification needs are read). */
export interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
  kid?: string;
  [key: string]: unknown;
}

/*
 * Mandates are signed as compact JWS (RFC 7515) with EdDSA over Ed25519 (RFC 8037). Each org has
 * its own signing key; the public keys are published as a JWKS so anyone can verify a mandate
 * without asking Aperture (plan/architecture §10).
 */

export interface PublicJwk extends Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  alg: 'EdDSA';
  use: 'sig';
}

export interface SigningKey {
  kid: string;
  publicJwk: PublicJwk;
  /** PKCS#8 PEM; callers envelope-encrypt it before storing. */
  privatePem: string;
}

export class JwsError extends Error {
  readonly code: 'malformed' | 'unknown_kid' | 'bad_signature' | 'unsupported';

  constructor(code: JwsError['code'], message: string) {
    super(message);
    this.name = 'JwsError';
    this.code = code;
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

export function generateSigningKey(): SigningKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = randomBytes(12).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') throw new Error('Ed25519 key export failed');
  return {
    kid,
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid, alg: 'EdDSA', use: 'sig' },
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
  };
}

export function signJws(
  payload: Record<string, unknown>,
  key: { kid: string; privatePem: string },
  typ = 'JWT',
): string {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', kid: key.kid, typ }));
  const body = b64url(JSON.stringify(payload));
  const signature = sign(null, Buffer.from(`${header}.${body}`), createPrivateKey(key.privatePem));
  return `${header}.${body}.${b64url(signature)}`;
}

/** Verifies a compact JWS against a JWKS and returns its payload. Throws JwsError otherwise. */
export function verifyJws(
  jws: string,
  jwks: { keys: readonly Jwk[] },
): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new JwsError('malformed', 'a compact JWS has three parts');
  const [headerPart = '', bodyPart = '', signaturePart = ''] = parts;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as Record<string, unknown>;
    payload = JSON.parse(Buffer.from(bodyPart, 'base64url').toString()) as Record<string, unknown>;
  } catch {
    throw new JwsError('malformed', 'header or payload is not base64url JSON');
  }
  if (header.alg !== 'EdDSA') throw new JwsError('unsupported', 'only EdDSA is accepted');
  const jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (jwk === undefined) throw new JwsError('unknown_kid', 'no key in the JWKS matches this signature');
  if (typeof jwk.x !== 'string') throw new JwsError('unknown_kid', 'the matching key has no public value');
  const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
  const ok = verify(null, Buffer.from(`${headerPart}.${bodyPart}`), publicKey, Buffer.from(signaturePart, 'base64url'));
  if (!ok) throw new JwsError('bad_signature', 'the signature does not match');
  return { header, payload };
}
