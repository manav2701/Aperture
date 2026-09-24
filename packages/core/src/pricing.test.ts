import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseUsd } from './money';
import { PricingError, actualTextCost, estimateMediaCost, estimateTextCost, type TextPrice } from './pricing';

// Example: USD 2.50 per 1M input tokens, USD 10 per 1M output tokens.
const price: TextPrice = {
  inputPerMTok: parseUsd('2.5'),
  outputPerMTok: parseUsd('10'),
  cacheReadPerMTok: parseUsd('1.25'),
};

describe('text pricing', () => {
  it('estimates input from bytes (3 bytes per token) plus the full output allowance', () => {
    // 3,000 bytes → 1,000 tokens → 2,500 µUSD; 1,000 output tokens → 10,000 µUSD.
    expect(estimateTextCost({ promptBytes: 3_000n, inputImages: 0n, maxOutputTokens: 1_000n }, price)).toBe(12_500n);
  });

  it('adds a per-image allowance for image inputs', () => {
    const withImages = { ...price, perInputImage: parseUsd('0.01') };
    expect(estimateTextCost({ promptBytes: 0n, inputImages: 2n, maxOutputTokens: 0n }, withImages)).toBe(20_000n);
  });

  it('charges cached tokens at the cache price and falls back to the input price', () => {
    expect(actualTextCost({ inputTokens: 0n, outputTokens: 0n, cacheReadTokens: 1_000_000n }, price)).toBe(1_250_000n);
    expect(actualTextCost({ inputTokens: 0n, outputTokens: 0n, cacheWriteTokens: 1_000_000n }, price)).toBe(2_500_000n);
  });

  it('never charges less than 1 µUSD, even for free models (L5)', () => {
    const free: TextPrice = { inputPerMTok: 0n, outputPerMTok: 0n };
    expect(estimateTextCost({ promptBytes: 3n, inputImages: 0n, maxOutputTokens: 1n }, free)).toBe(1n);
    expect(actualTextCost({ inputTokens: 1n, outputTokens: 1n }, free)).toBe(1n);
  });

  it('rounds each sub-micro component up rather than to zero', () => {
    const tiny: TextPrice = { inputPerMTok: 1n, outputPerMTok: 1n };
    expect(actualTextCost({ inputTokens: 1n, outputTokens: 1n }, tiny)).toBe(2n);
  });

  it('estimate covers the actual cost whenever usage stays within the estimate assumptions', () => {
    const prices = fc.record({
      inputPerMTok: fc.bigInt({ min: 0n, max: 100_000_000n }),
      outputPerMTok: fc.bigInt({ min: 0n, max: 100_000_000n }),
    });
    fc.assert(
      fc.property(
        prices,
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 200_000n }),
        fc.bigInt({ min: 0n, max: 1_000n }),
        (p, bytes, maxOut, outSlack) => {
          const estimate = estimateTextCost({ promptBytes: bytes, inputImages: 0n, maxOutputTokens: maxOut }, p);
          const maxInputTokens = (bytes + 2n) / 3n;
          const outputTokens = maxOut > outSlack ? maxOut - outSlack : 0n;
          expect(actualTextCost({ inputTokens: maxInputTokens, outputTokens }, p)).toBeLessThanOrEqual(estimate);
        },
      ),
    );
  });
});

describe('media pricing', () => {
  it('prices images per image and video per second', () => {
    expect(estimateMediaCost({ kind: 'image', count: 4n }, { perImage: parseUsd('0.04') })).toBe(160_000n);
    expect(estimateMediaCost({ kind: 'video', seconds: 8n, count: 1n }, { perSecond: parseUsd('0.4') })).toBe(
      3_200_000n,
    );
  });

  it('refuses to price a model without the needed unit price', () => {
    expect(() => estimateMediaCost({ kind: 'video', seconds: 4n, count: 1n }, { perImage: 1n })).toThrow(PricingError);
  });
});
