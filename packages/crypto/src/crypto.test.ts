import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CanonicalJsonError, canonicalJson, type JsonValue } from './canonical';
import { GENESIS_HASH, chainHash, merkleRoot, sha256Hex, verifyChain, type ChainRecord } from './chain';

describe('canonicalJson (RFC 8785)', () => {
  it('sorts keys and uses the canonical number and string forms', () => {
    // Vectors from RFC 8785 §3.2.2 and appendix B.
    expect(canonicalJson({ b: 2, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":2}');
    expect(canonicalJson({ numbers: [Number('333333333.33333329'), 1e30, 4.5, 0.002, 1e-27] })).toBe(
      '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
    );
    expect(canonicalJson({ literals: [null, true, false] })).toBe('{"literals":[null,true,false]}');
    expect(canonicalJson('€$\u000f\nA\'B"\\\\"/')).toBe('"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"');
  });

  it('is independent of key insertion order', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (object) => {
        const reversed = Object.fromEntries(Object.entries(object).reverse());
        expect(canonicalJson(reversed as JsonValue)).toBe(canonicalJson(object as JsonValue));
      }),
    );
  });

  it('refuses values that are not plain JSON', () => {
    for (const value of [1n, undefined, new Date(0), Number.NaN, Number.POSITIVE_INFINITY, { nested: { big: 2n } }]) {
      expect(() => canonicalJson(value as JsonValue)).toThrow(CanonicalJsonError);
    }
  });
});

const buildChain = (bodies: JsonValue[]): ChainRecord[] => {
  let prevHash = GENESIS_HASH;
  return bodies.map((body, index) => {
    const hash = chainHash(prevHash, body);
    const record = { seq: index + 1, prevHash, hash, body };
    prevHash = hash;
    return record;
  });
};

const bodiesArb = fc.array(fc.record({ action: fc.string(), amount: fc.string(), n: fc.integer() }), {
  minLength: 1,
  maxLength: 30,
});

describe('hash chain', () => {
  it('verifies an intact chain and reports its last hash', () => {
    const chain = buildChain([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(verifyChain(chain)).toEqual({ ok: true, count: 3, lastHash: chain[2]?.hash });
  });

  it('verifies a segment given the hash before it', () => {
    const chain = buildChain([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(verifyChain(chain.slice(1), { startPrevHash: chain[0]?.hash ?? '' }).ok).toBe(true);
    expect(verifyChain(chain.slice(1)).ok).toBe(false);
  });

  it('detects gaps, reordering, and removed events', () => {
    const chain = buildChain([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const [first, second, third] = chain as [ChainRecord, ChainRecord, ChainRecord];
    expect(verifyChain([first, third])).toMatchObject({ ok: false, seq: 3, reason: 'sequence_gap' });
    expect(verifyChain([first, { ...third, seq: 2 }])).toMatchObject({ ok: false, reason: 'prev_hash_mismatch' });
    expect(verifyChain([second, first]).ok).toBe(false);
  });

  it('INV-15: any change to any stored event is detected', () => {
    fc.assert(
      fc.property(
        bodiesArb,
        fc.nat(),
        fc.constantFrom('body', 'hash', 'prevHash', 'seq'),
        fc.string({ minLength: 1 }),
        (bodies, pick, field, junk) => {
          const chain = buildChain(bodies);
          const index = pick % chain.length;
          const original = chain[index];
          if (original === undefined) return;
          const tampered: ChainRecord =
            field === 'body'
              ? { ...original, body: { ...(original.body as object), tampered: junk } }
              : field === 'seq'
                ? { ...original, seq: original.seq + 1 }
                : { ...original, [field]: sha256Hex(junk + original[field]) };
          const copy = [...chain];
          copy[index] = tampered;
          const result = verifyChain(copy);
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.seq).toBeLessThanOrEqual(original.seq + 1);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

describe('merkleRoot', () => {
  const hashes = ['a', 'b', 'c'].map((value) => sha256Hex(value));

  it('is deterministic and order-sensitive', () => {
    expect(merkleRoot(hashes)).toBe(merkleRoot([...hashes]));
    expect(merkleRoot(hashes)).not.toBe(merkleRoot([...hashes].reverse()));
  });

  it('changes when any leaf changes', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 20 }), fc.nat(), (values, pick) => {
        const leaves = values.map((value) => sha256Hex(value));
        const index = pick % leaves.length;
        const changed = [...leaves];
        changed[index] = sha256Hex(`${values[index] ?? ''}!`);
        expect(merkleRoot(changed)).not.toBe(merkleRoot(leaves));
      }),
    );
  });

  it('separates leaves from interior nodes', () => {
    const [x, y] = hashes as [string, string];
    const interior = sha256Hex(
      Buffer.concat([
        Buffer.from([1]),
        Buffer.from(sha256Hex(Buffer.concat([Buffer.from([0]), Buffer.from(x, 'hex')])), 'hex'),
        Buffer.from(sha256Hex(Buffer.concat([Buffer.from([0]), Buffer.from(y, 'hex')])), 'hex'),
      ]),
    );
    expect(merkleRoot([x, y])).toBe(interior);
    expect(merkleRoot([interior])).not.toBe(merkleRoot([x, y]));
  });

  it('has a defined root for no leaves', () => {
    expect(merkleRoot([])).toBe(sha256Hex(''));
  });
});
