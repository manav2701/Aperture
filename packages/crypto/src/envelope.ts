import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/*
 * Envelope encryption for secrets we must store (provider admin keys, card program keys):
 * each secret is encrypted with its own random data key (AES-256-GCM), and the data key is
 * encrypted ("wrapped") with a key-encryption key (KEK) that lives outside the database.
 * Rotating the KEK only re-wraps data keys. The associated data binds a ciphertext to where it
 * is stored (e.g. "orgId|connectionId"), so it can't be copied onto another row and decrypted.
 */

export interface KeyRing {
  currentVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export interface Envelope {
  /** Format version. */
  v: 1;
  /** KEK version that wrapped the data key. */
  kek: number;
  /** Wrapped data key: base64(iv ‖ tag ‖ ciphertext). */
  dek: string;
  /** Secret: base64(iv ‖ tag ‖ ciphertext). */
  data: string;
}

export class EnvelopeError extends Error {
  readonly code: 'invalid_key_ring' | 'unknown_kek' | 'decryption_failed' | 'invalid_envelope';

  constructor(code: EnvelopeError['code'], message: string) {
    super(message);
    this.name = 'EnvelopeError';
    this.code = code;
  }
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Reads KEKs from environment variables named APERTURE_KEK_V<n> (base64, 32 bytes). The highest
 * version encrypts; older versions stay readable until every envelope has been re-wrapped.
 */
export function keyRingFromEnv(env: Readonly<Record<string, string | undefined>>): KeyRing {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^APERTURE_KEK_V(\d+)$/.exec(name);
    if (!match || value === undefined || value === '') continue;
    const key = Buffer.from(value, 'base64');
    if (key.length !== KEY_BYTES) throw new EnvelopeError('invalid_key_ring', `${name} must be 32 bytes of base64`);
    keys.set(Number(match[1]), key);
  }
  if (keys.size === 0) throw new EnvelopeError('invalid_key_ring', 'no APERTURE_KEK_V<n> key is configured');
  return { currentVersion: Math.max(...keys.keys()), keys };
}

function seal(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function open(key: Buffer, sealed: string, aad: string): Buffer {
  const bytes = Buffer.from(sealed, 'base64');
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new EnvelopeError('invalid_envelope', 'ciphertext too short');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
  } catch {
    throw new EnvelopeError(
      'decryption_failed',
      'the secret could not be decrypted (wrong key, context, or tampered data)',
    );
  }
}

function kekFor(ring: KeyRing, version: number): Buffer {
  const key = ring.keys.get(version);
  if (!key) throw new EnvelopeError('unknown_kek', `key-encryption key version ${String(version)} is not configured`);
  return key;
}

export function encryptSecret(plaintext: string, context: string, ring: KeyRing): Envelope {
  const dataKey = randomBytes(KEY_BYTES);
  try {
    return {
      v: 1,
      kek: ring.currentVersion,
      dek: seal(kekFor(ring, ring.currentVersion), dataKey, `dek|${context}`),
      data: seal(dataKey, Buffer.from(plaintext, 'utf8'), `data|${context}`),
    };
  } finally {
    dataKey.fill(0);
  }
}

function assertEnvelope(value: unknown): asserts value is Envelope {
  const candidate = value as Partial<Envelope> | null | undefined;
  if (
    typeof candidate !== 'object' ||
    candidate?.v !== 1 ||
    typeof candidate.kek !== 'number' ||
    typeof candidate.dek !== 'string' ||
    typeof candidate.data !== 'string'
  ) {
    throw new EnvelopeError('invalid_envelope', 'not an envelope');
  }
}

export function decryptSecret(envelope: unknown, context: string, ring: KeyRing): string {
  assertEnvelope(envelope);
  const dataKey = open(kekFor(ring, envelope.kek), envelope.dek, `dek|${context}`);
  try {
    return open(dataKey, envelope.data, `data|${context}`).toString('utf8');
  } finally {
    dataKey.fill(0);
  }
}

/** Re-wraps the data key with the current KEK (after a rotation). The secret itself isn't touched. */
export function rewrapSecret(envelope: unknown, context: string, ring: KeyRing): Envelope {
  assertEnvelope(envelope);
  if (envelope.kek === ring.currentVersion) return envelope;
  const dataKey = open(kekFor(ring, envelope.kek), envelope.dek, `dek|${context}`);
  try {
    return {
      ...envelope,
      kek: ring.currentVersion,
      dek: seal(kekFor(ring, ring.currentVersion), dataKey, `dek|${context}`),
    };
  } finally {
    dataKey.fill(0);
  }
}
