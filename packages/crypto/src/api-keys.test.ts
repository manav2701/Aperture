import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey, looksLikeApiKey, signWorkspaceToken, verifyWorkspaceToken } from './api-keys';

const pepper = 'p'.repeat(32);

describe('gateway keys', () => {
  it('are random, well-formed and recognisable by prefix', () => {
    const keys = Array.from({ length: 200 }, () => generateApiKey('live'));
    expect(new Set(keys.map((k) => k.key)).size).toBe(200);
    for (const { key, prefix } of keys) {
      expect(looksLikeApiKey(key)).toBe(true);
      expect(key).toHaveLength('apk_live_'.length + 43);
      expect(prefix).toBe(key.slice(0, 12));
    }
    expect(looksLikeApiKey(generateApiKey('test').key)).toBe(true);
  });

  it('are stored as a peppered HMAC', () => {
    const { key } = generateApiKey('test');
    expect(hashApiKey(key, pepper)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key, pepper)).not.toBe(hashApiKey(key, 'q'.repeat(32)));
    expect(() => hashApiKey(key, 'short')).toThrow();
  });

  it('rejects anything that is not a key before it reaches the database', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        if (!/^apk_(live|test)_[0-9A-Za-z]{40,50}$/.test(value)) expect(looksLikeApiKey(value)).toBe(false);
      }),
    );
  });
});

describe('workspace tokens', () => {
  const claims = { orgId: 'org', principalId: 'p', exp: Math.floor(Date.now() / 1000) + 300 };

  it('round-trip, and fail when tampered with, expired or signed with another secret', () => {
    const token = signWorkspaceToken(claims, 'secret-a');
    expect(verifyWorkspaceToken(token, 'secret-a')).toEqual(claims);
    expect(verifyWorkspaceToken(token, 'secret-b')).toBeUndefined();
    expect(verifyWorkspaceToken(token, 'secret-a', (claims.exp + 1) * 1000)).toBeUndefined();

    const [kind, payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, principalId: 'someone-else' })).toString('base64url');
    expect(verifyWorkspaceToken(`${kind ?? ''}.${forged}.${signature ?? ''}`, 'secret-a')).toBeUndefined();
    expect(verifyWorkspaceToken(`${kind ?? ''}.${payload ?? ''}`, 'secret-a')).toBeUndefined();
  });

  it('never throws on garbage', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(verifyWorkspaceToken(value, 'secret-a')).toBeUndefined();
      }),
    );
  });
});
