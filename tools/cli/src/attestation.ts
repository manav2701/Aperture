import { ATTESTATION_JWS_TYP, ATTESTATION_TYPE, type AttestationDocument } from '@aperture/core';
import { JwsError, canonicalJson, merkleRoot, verifyJws, type Jwk, type JsonValue } from '@aperture/crypto';
import { verifyAuditExport } from './verify';

export type AttestationVerification =
  | {
      ok: true;
      kid: string;
      document: AttestationDocument;
      /** Present when an audit export was checked against the attestation's audit proof. */
      audit?: { events: number; merkleRoot: string };
    }
  | { ok: false; reason: string; document?: AttestationDocument };

/**
 * The compact JWS from an attestation file: the JSON Aperture downloads (`{ document, jws }`),
 * or the bare JWS. When the file also carries `document`, it must equal the signed payload,
 * because people read that field and only the payload is signed.
 */
function extract(input: string): { jws: string; document?: unknown } | { error: string } {
  const text = input.trim();
  if (!text.startsWith('{')) return { jws: text };
  try {
    const parsed = JSON.parse(text) as { jws?: unknown; document?: unknown };
    if (typeof parsed.jws !== 'string') return { error: 'the file has no "jws" field' };
    return parsed.document === undefined ? { jws: parsed.jws } : { jws: parsed.jws, document: parsed.document };
  } catch {
    return { error: 'the file is not JSON or a compact JWS' };
  }
}

/** Keeps the audit export lines inside the attested range; an export may hold the whole chain. */
function auditRange(jsonl: string, first: number, last: number): string {
  return jsonl
    .split('\n')
    .filter((line) => {
      if (line.trim() === '') return false;
      try {
        const seq = (JSON.parse(line) as { seq?: unknown }).seq;
        return typeof seq !== 'number' || (seq >= first && seq <= last);
      } catch {
        return true; // let the audit verifier report the bad line
      }
    })
    .join('\n');
}

/**
 * Verifies an attestation offline: the signature against the JWKS, that it really is an
 * attestation (the same key signs agent cards), and, with the period's audit export, that the
 * events link up from the attested previous hash and give the attested last hash and Merkle root.
 * Never throws on bad input.
 */
export function verifyAttestation(
  input: string,
  jwks: { keys: readonly Jwk[] },
  auditExport?: string,
): AttestationVerification {
  const extracted = extract(input);
  if ('error' in extracted) return { ok: false, reason: extracted.error };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    ({ header, payload } = verifyJws(extracted.jws, jwks));
  } catch (error) {
    return { ok: false, reason: error instanceof JwsError ? error.message : 'the JWS could not be read' };
  }
  if (header.typ !== ATTESTATION_JWS_TYP || payload.type !== ATTESTATION_TYPE)
    return { ok: false, reason: 'validly signed, but not an Aperture attestation' };
  const document = payload as unknown as AttestationDocument;
  if (
    extracted.document !== undefined &&
    canonicalJson(extracted.document as JsonValue) !== canonicalJson(payload as JsonValue)
  )
    return { ok: false, reason: 'the "document" field differs from what was signed', document };
  if (auditExport === undefined) return { ok: true, kid: String(header.kid), document };

  const claimed = document.audit;
  if (claimed.firstSeq === null || claimed.lastSeq === null)
    return { ok: false, reason: 'the attestation covers no audit events, so there is nothing to compare', document };
  const range = auditRange(auditExport, claimed.firstSeq, claimed.lastSeq);
  const chain = verifyAuditExport(
    range,
    claimed.prevHash === null ? {} : { startPrevHash: claimed.prevHash, startSeq: claimed.firstSeq },
  );
  if (!chain.ok) return { ok: false, reason: `audit export: ${chain.reason} at ${chain.where}`, document };
  if (chain.count !== claimed.events)
    return {
      ok: false,
      reason: `audit export has ${String(chain.count)} events in range, the attestation says ${String(claimed.events)}`,
      document,
    };
  if (chain.lastHash !== claimed.lastHash)
    return { ok: false, reason: 'the last hash differs from the attestation', document };
  const root = merkleRoot(chain.hashes);
  if (root !== claimed.merkleRoot)
    return { ok: false, reason: 'the Merkle root differs from the attestation', document };
  return { ok: true, kid: String(header.kid), document, audit: { events: chain.count, merkleRoot: root } };
}
