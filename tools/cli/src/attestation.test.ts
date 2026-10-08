import { ATTESTATION_DISCLAIMER, ATTESTATION_JWS_TYP, ATTESTATION_TYPE } from '@aperture/core';
import { GENESIS_HASH, chainHash, generateSigningKey, merkleRoot, signJws, type JsonValue } from '@aperture/crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { verifyAttestation } from './attestation';

/** A five-event chain; the attestation covers seq 2–4, like a month in the middle of a chain. */
function chain() {
  let prevHash = GENESIS_HASH;
  return [1, 2, 3, 4, 5].map((seq) => {
    const body = { action: `event-${String(seq)}` };
    const hash = chainHash(prevHash, body);
    const record = { seq, prevHash, hash, body };
    prevHash = hash;
    return record;
  });
}

function attestation(records: ReturnType<typeof chain>, overrides: Record<string, unknown> = {}) {
  const inRange = records.filter((r) => r.seq >= 2 && r.seq <= 4);
  return {
    type: ATTESTATION_TYPE,
    version: 1,
    id: 'att-1',
    issuer: { kind: 'aperture_cloud', instance: 'cloud', jwksUrl: 'https://example.test/jwks.json' },
    org: { id: 'org-1', name: 'Acme' },
    period: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z', timezone: 'Asia/Dubai' },
    generatedAt: '2026-10-02T00:00:00Z',
    apertureVersion: 'test',
    posture: { catalogueVersion: 1, score: 87, grade: 'B', results: [], worstDuringPeriod: [], runs: 3 },
    activity: {},
    coverage: [],
    audit: {
      events: inRange.length,
      firstSeq: 2,
      lastSeq: 4,
      prevHash: inRange[0]?.prevHash ?? null,
      lastHash: inRange.at(-1)?.hash ?? null,
      merkleRoot: merkleRoot(inRange.map((r) => r.hash)),
      chainIntact: true,
      brokenAtSeq: null,
      anchors: [],
    },
    agents: [],
    disclaimer: ATTESTATION_DISCLAIMER,
    ...overrides,
  };
}

const key = generateSigningKey();
const jwks = { keys: [key.publicJwk] };
const records = chain();
const exportText = records.map((r) => JSON.stringify(r)).join('\n');
const document = attestation(records);
const file = JSON.stringify({ document, jws: signJws(document, key, ATTESTATION_JWS_TYP) });

describe('verifyAttestation', () => {
  it('accepts the downloaded file and a bare JWS', () => {
    expect(verifyAttestation(file, jwks)).toMatchObject({
      ok: true,
      kid: key.kid,
      document: { org: { name: 'Acme' } },
    });
    expect(verifyAttestation(signJws(document, key, ATTESTATION_JWS_TYP), jwks)).toMatchObject({ ok: true });
  });

  it('recomputes the chain range and Merkle root from a full audit export', () => {
    expect(verifyAttestation(file, jwks, exportText)).toMatchObject({
      ok: true,
      audit: { events: 3, merkleRoot: document.audit.merkleRoot },
    });
  });

  it('rejects a changed payload, an edited "document" field, an unknown key, and an agent card', () => {
    const jws = signJws(document, key, ATTESTATION_JWS_TYP);
    const [h = '', b = '', s = ''] = jws.split('.');
    const forged = Buffer.from(Buffer.from(b, 'base64url').toString().replace('"score":87', '"score":97')).toString(
      'base64url',
    );
    expect(verifyAttestation(`${h}.${forged}.${s}`, jwks)).toMatchObject({ ok: false });

    const edited = JSON.stringify({ document: { ...document, posture: { ...document.posture, score: 97 } }, jws });
    expect(verifyAttestation(edited, jwks)).toMatchObject({
      ok: false,
      reason: 'the "document" field differs from what was signed',
    });

    expect(verifyAttestation(file, { keys: [generateSigningKey().publicJwk] })).toMatchObject({ ok: false });

    const card = signJws({ type: 'aperture.agent-card', version: 1 }, key, 'aperture-agent-card+jws');
    expect(verifyAttestation(card, jwks)).toMatchObject({
      ok: false,
      reason: 'validly signed, but not an Aperture attestation',
    });
  });

  it('catches an audit export that was edited, cut short, or belongs to another period', () => {
    const edited = exportText.replace('"event-3"', '"event-X"');
    expect(verifyAttestation(file, jwks, edited)).toMatchObject({ ok: false });

    const missing = records
      .filter((r) => r.seq !== 3)
      .map((r) => JSON.stringify(r))
      .join('\n');
    expect(verifyAttestation(file, jwks, missing)).toMatchObject({ ok: false });

    // A different, internally valid chain doesn't link to the attested previous hash.
    let prevHash = GENESIS_HASH;
    const other = [1, 2, 3, 4, 5]
      .map((seq) => {
        const body: JsonValue = { action: `other-${String(seq)}` };
        const hash = chainHash(prevHash, body);
        const line = JSON.stringify({ seq, prevHash, hash, body });
        prevHash = hash;
        return line;
      })
      .join('\n');
    expect(verifyAttestation(file, jwks, other)).toMatchObject({ ok: false });
  });

  it('fuzz: never throws and never accepts arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.string(), { nil: undefined }), (input, audit) => {
        expect(verifyAttestation(input, jwks, audit).ok).toBe(false);
      }),
    );
  });
});
