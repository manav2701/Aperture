/*
 * In-browser verification of Aperture attestations (plan/phases/phase-11 §11.5): the JWS
 * signature against the published JWKS with WebCrypto Ed25519, and, given the period's audit
 * export, the sequence, the hash links, and the Merkle root. Nothing is uploaded anywhere.
 * Recomputing each event's own hash needs canonical JSON (RFC 8785); the CLI does that
 * (`pnpm attestation-verify --audit`).
 */

import { ATTESTATION_JWS_TYP, ATTESTATION_TYPE } from '@aperture/core';

export interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
  kid?: string;
}

export interface SignatureCheck {
  ok: boolean;
  kid: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
}

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export async function verifyAttestationJws(jws: string, jwks: { keys: Jwk[] }): Promise<SignatureCheck> {
  const parts = jws.trim().split('.');
  if (parts.length !== 3) return { ok: false, kid: null, reason: 'not a compact JWS', payload: null };
  const [headerPart = '', bodyPart = '', signaturePart = ''] = parts;
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(headerPart))) as typeof header;
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(bodyPart))) as Record<string, unknown>;
  } catch {
    return { ok: false, kid: null, reason: 'the JWS is not valid JSON', payload: null };
  }
  if (header.alg !== 'EdDSA') return { ok: false, kid: header.kid ?? null, reason: 'unsupported algorithm', payload };
  // The same key signs agent cards; a validly signed card must not pass as an attestation.
  if (header.typ !== ATTESTATION_JWS_TYP || payload.type !== ATTESTATION_TYPE)
    return { ok: false, kid: header.kid ?? null, reason: 'this is not an Aperture attestation', payload: null };
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (jwk?.x === undefined)
    return { ok: false, kid: header.kid ?? null, reason: 'the signing key is not published', payload };
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      fromBase64Url(signaturePart),
      new TextEncoder().encode(`${headerPart}.${bodyPart}`),
    );
    return { ok, kid: header.kid ?? null, reason: ok ? null : 'the signature does not match', payload };
  } catch {
    return {
      ok: false,
      kid: header.kid ?? null,
      reason: 'this browser cannot verify Ed25519 signatures; use the CLI',
      payload,
    };
  }
}

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};
const sha256 = async (parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return toHex(await crypto.subtle.digest('SHA-256', joined));
};

/** The same Merkle root as @aperture/crypto merkleRoot (RFC 6962 domain separation). */
export async function merkleRoot(hashes: readonly string[]): Promise<string> {
  if (hashes.length === 0) return sha256([]);
  let level = await Promise.all(hashes.map((hash) => sha256([new Uint8Array([0]), fromHex(hash)])));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (left === undefined) break;
      next.push(right === undefined ? left : await sha256([new Uint8Array([1]), fromHex(left), fromHex(right)]));
    }
    level = next;
  }
  return level[0] ?? (await sha256([]));
}

export interface AuditRangeCheck {
  ok: boolean;
  reason: string | null;
  events: number;
  merkleRoot: string;
}

/** Checks a JSONL audit export against the attestation's range, links, and Merkle root. */
export async function checkAuditExport(
  jsonl: string,
  claimed: {
    firstSeq: number | null;
    lastSeq: number | null;
    prevHash: string | null;
    lastHash: string | null;
    merkleRoot: string | null;
  },
): Promise<AuditRangeCheck> {
  const all = jsonl
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { seq: number; prevHash: string; hash: string });
  const records = all.filter(
    (r) =>
      claimed.firstSeq !== null && claimed.lastSeq !== null && r.seq >= claimed.firstSeq && r.seq <= claimed.lastSeq,
  );
  const root = await merkleRoot(records.map((r) => r.hash));
  if (claimed.firstSeq === null) return { ok: records.length === 0, reason: null, events: 0, merkleRoot: root };
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record === undefined) continue;
    if (record.seq !== claimed.firstSeq + i)
      return {
        ok: false,
        reason: `missing event before seq ${String(record.seq)}`,
        events: records.length,
        merkleRoot: root,
      };
    const previous = i === 0 ? claimed.prevHash : records[i - 1]?.hash;
    if (record.prevHash !== previous)
      return {
        ok: false,
        reason: `broken link at seq ${String(record.seq)}`,
        events: records.length,
        merkleRoot: root,
      };
  }
  if (records.at(-1)?.hash !== claimed.lastHash)
    return { ok: false, reason: 'the last hash differs', events: records.length, merkleRoot: root };
  if (root !== claimed.merkleRoot)
    return { ok: false, reason: 'the Merkle root differs', events: records.length, merkleRoot: root };
  return { ok: true, reason: null, events: records.length, merkleRoot: root };
}
