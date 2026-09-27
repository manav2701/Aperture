import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JwsError, generateSigningKey, signJws, verifyJws } from './jws';

describe('mandate JWS (EdDSA / Ed25519)', () => {
  it('verifies with the published public key, including after rotation', () => {
    const old = generateSigningKey();
    const current = generateSigningKey();
    const jwks = { keys: [old.publicJwk, current.publicJwk] };
    const signedByOld = signJws({ sub: 'agent-1', scope: { rails: ['gateway'] } }, old);
    expect(verifyJws(signedByOld, jwks).payload).toMatchObject({ sub: 'agent-1' });
    const signedByCurrent = signJws({ sub: 'agent-2' }, current, 'aperture-mandate+jwt');
    expect(verifyJws(signedByCurrent, jwks).header).toMatchObject({
      alg: 'EdDSA',
      kid: current.kid,
      typ: 'aperture-mandate+jwt',
    });
    expect(current.publicJwk).not.toHaveProperty('d');
  });

  it('rejects tampering, unknown keys and other algorithms', () => {
    const key = generateSigningKey();
    const jwks = { keys: [key.publicJwk] };
    const jws = signJws({ sub: 'agent-1', budget: '5.00' }, key);
    const [header, , signature] = jws.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'agent-1', budget: '5000.00' })).toString('base64url');
    expect(() => verifyJws(`${header ?? ''}.${forged}.${signature ?? ''}`, jwks)).toThrow(JwsError);
    expect(() => verifyJws(jws, { keys: [generateSigningKey().publicJwk] })).toThrow(/no key/);
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: key.kid })).toString('base64url')}.${forged}.`;
    expect(() => verifyJws(none, jwks)).toThrow(/EdDSA/);
  });

  it('never accepts garbage', () => {
    const jwks = { keys: [generateSigningKey().publicJwk] };
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(() => verifyJws(value, jwks)).toThrow(JwsError);
      }),
      { numRuns: 300 },
    );
  });
});
