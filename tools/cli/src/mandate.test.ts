import { generateSigningKey, signJws } from '@aperture/crypto';
import { describe, expect, it } from 'vitest';
import { verifyMandate } from './mandate';

const key = generateSigningKey();
const jwks = { keys: [key.publicJwk] };
const now = new Date('2026-09-01T12:00:00Z');
const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function mandate(jti: string, scope: Record<string, unknown>, extra: Record<string, unknown> = {}, signer = key) {
  return signJws(
    {
      iss: 'aperture:org:o1',
      sub: `aperture:principal:${jti}-agent`,
      jti,
      scope: {
        rails: ['gateway'],
        budget: { limit: '1', period: 'day' },
        notBefore: '2026-09-01T00:00:00Z',
        expiresAt: '2026-09-02T00:00:00Z',
        purpose: jti,
        ...scope,
      },
      nbf: t('2026-09-01T00:00:00Z'),
      exp: t('2026-09-02T00:00:00Z'),
      ...extra,
    },
    signer,
    'aperture-mandate+jwt',
  );
}

describe('verifyMandate (offline)', () => {
  it('accepts a chain where each delegation narrows its parent', () => {
    const root = mandate('root', {});
    const child = mandate(
      'child',
      { budget: { limit: '0.25', period: 'day' }, models: ['openai/*'] },
      { parent: 'root' },
    );
    expect(verifyMandate(child, jwks, { parents: [root], now })).toMatchObject({ ok: true, id: 'child', depth: 2 });
  });

  it('rejects widening, wrong parents, expiry, other signers and plain JWTs', () => {
    const root = mandate('root', { models: ['openai/*'] });
    const wider = mandate('wide', { budget: { limit: '5', period: 'day' } }, { parent: 'root' });
    expect(verifyMandate(wider, jwks, { parents: [root], now })).toMatchObject({ ok: false });
    const orphan = mandate('orphan', {}, { parent: 'someone-else' });
    expect(verifyMandate(orphan, jwks, { parents: [root], now }).ok).toBe(false);
    expect(verifyMandate(root, jwks, { now: new Date('2026-09-03T00:00:00Z') })).toEqual({
      ok: false,
      reason: 'the mandate has expired',
    });
    expect(verifyMandate(mandate('x', {}, {}, generateSigningKey()), jwks, { now }).ok).toBe(false);
    expect(verifyMandate(signJws({ jti: 'x' }, key), jwks, { now })).toEqual({
      ok: false,
      reason: 'not an Aperture mandate',
    });
  });
});
