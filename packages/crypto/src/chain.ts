import { createHash } from 'node:crypto';
import { canonicalJson, type JsonValue } from './canonical';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `prev_hash` of the first event in every chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** hash = SHA-256(prev_hash ‖ JCS(body)) — plan/architecture §15. */
export function chainHash(prevHash: string, body: JsonValue): string {
  return sha256Hex(prevHash + canonicalJson(body));
}

export interface ChainRecord {
  seq: number;
  prevHash: string;
  hash: string;
  body: JsonValue;
}

export type ChainVerification =
  | { ok: true; count: number; lastHash: string }
  | { ok: false; seq: number; reason: 'sequence_gap' | 'prev_hash_mismatch' | 'hash_mismatch' };

/**
 * Verifies an exported chain segment. Pass the hash that precedes the segment (GENESIS_HASH
 * for a chain that starts at seq 1) so a segment can be checked without the whole history.
 */
export function verifyChain(
  records: readonly ChainRecord[],
  options: { startPrevHash?: string; startSeq?: number } = {},
): ChainVerification {
  let expectedPrev = options.startPrevHash ?? GENESIS_HASH;
  // A chain that starts at genesis starts at seq 1; otherwise trust the caller's anchor.
  let expectedSeq = options.startSeq ?? (options.startPrevHash === undefined ? 1 : (records[0]?.seq ?? 1));
  for (const record of records) {
    if (record.seq !== expectedSeq) return { ok: false, seq: record.seq, reason: 'sequence_gap' };
    if (record.prevHash !== expectedPrev) return { ok: false, seq: record.seq, reason: 'prev_hash_mismatch' };
    if (chainHash(record.prevHash, record.body) !== record.hash) {
      return { ok: false, seq: record.seq, reason: 'hash_mismatch' };
    }
    expectedPrev = record.hash;
    expectedSeq += 1;
  }
  return { ok: true, count: records.length, lastHash: expectedPrev };
}

/**
 * Merkle root over hex hashes, RFC 6962 style: leaves and interior nodes are domain-separated
 * (0x00 / 0x01 prefixes) so a leaf can never be passed off as a node. An odd node at any level
 * is promoted unchanged. The root of zero leaves is SHA-256 of the empty string.
 */
export function merkleRoot(hashes: readonly string[]): string {
  if (hashes.length === 0) return sha256Hex('');
  let level = hashes.map((hash) => sha256Hex(Buffer.concat([Buffer.from([0]), Buffer.from(hash, 'hex')])));
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (left === undefined) break;
      next.push(
        right === undefined
          ? left
          : sha256Hex(Buffer.concat([Buffer.from([1]), Buffer.from(left, 'hex'), Buffer.from(right, 'hex')])),
      );
    }
    level = next;
  }
  return level[0] ?? sha256Hex('');
}
