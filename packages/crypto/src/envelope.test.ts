import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EnvelopeError, decryptSecret, encryptSecret, keyRingFromEnv, rewrapSecret, type Envelope } from './envelope';

const key = () => randomBytes(32).toString('base64');
const v1 = key();
const v2 = key();
const ringV1 = keyRingFromEnv({ APERTURE_KEK_V1: v1 });
const ringV1V2 = keyRingFromEnv({ APERTURE_KEK_V1: v1, APERTURE_KEK_V2: v2 });
const ringV2Only = keyRingFromEnv({ APERTURE_KEK_V2: v2 });
const context = 'org-1|connection-1';

describe('keyRingFromEnv', () => {
  it('uses the highest version for new encryptions', () => {
    expect(ringV1V2.currentVersion).toBe(2);
  });

  it('rejects missing or malformed keys', () => {
    expect(() => keyRingFromEnv({})).toThrow(EnvelopeError);
    expect(() => keyRingFromEnv({ APERTURE_KEK_V1: Buffer.from('short').toString('base64') })).toThrow(/32 bytes/);
  });
});

describe('envelope encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const envelope = encryptSecret('sk-or-v1-secret', context, ringV1);
    expect(JSON.stringify(envelope)).not.toContain('sk-or-v1-secret');
    expect(decryptSecret(envelope, context, ringV1)).toBe('sk-or-v1-secret');
  });

  it('uses a fresh data key and IV every time', () => {
    const a = encryptSecret('same', context, ringV1);
    const b = encryptSecret('same', context, ringV1);
    expect(a.data).not.toBe(b.data);
    expect(a.dek).not.toBe(b.dek);
  });

  it('refuses a ciphertext moved to another row (context mismatch)', () => {
    const envelope = encryptSecret('secret', context, ringV1);
    expect(() => decryptSecret(envelope, 'org-2|connection-1', ringV1)).toThrow(/could not be decrypted/);
  });

  it('detects tampering', () => {
    const envelope = encryptSecret('secret', context, ringV1);
    const bytes = Buffer.from(envelope.data, 'base64');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret({ ...envelope, data: bytes.toString('base64') }, context, ringV1)).toThrow(
      EnvelopeError,
    );
    expect(() => decryptSecret({ ...envelope, kek: 9 }, context, ringV1)).toThrow(/version 9/);
    expect(() => decryptSecret({ nonsense: true }, context, ringV1)).toThrow(/not an envelope/);
  });

  it('rotates keys by re-wrapping only the data key', () => {
    const old: Envelope = encryptSecret('secret', context, ringV1);
    expect(decryptSecret(old, context, ringV1V2)).toBe('secret');
    const rewrapped = rewrapSecret(old, context, ringV1V2);
    expect(rewrapped.kek).toBe(2);
    expect(rewrapped.data).toBe(old.data);
    expect(decryptSecret(rewrapped, context, ringV2Only)).toBe('secret');
    expect(() => decryptSecret(old, context, ringV2Only)).toThrow(/version 1/);
  });

  it('round-trips arbitrary secrets and contexts', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string(), (secret, ctx) => {
        expect(decryptSecret(encryptSecret(secret, ctx, ringV1V2), ctx, ringV1V2)).toBe(secret);
      }),
    );
  });
});
