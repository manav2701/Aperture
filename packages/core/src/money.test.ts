import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_ABS_MICROS,
  MoneyError,
  ceilDiv,
  formatUsd,
  formatUsdRounded,
  fromAtomicUsd,
  fromCents,
  micros,
  parseUsd,
} from './money';

describe('parseUsd', () => {
  it.each([
    ['0', 0n],
    ['1', 1_000_000n],
    ['12.5', 12_500_000n],
    ['0.000001', 1n],
    ['9223372036854.775807', MAX_ABS_MICROS],
  ])('parses %s', (input, expected) => {
    expect(parseUsd(input)).toBe(expected);
  });

  it.each(['', ' 1', '1 ', '.5', '01', '1.', '1.0000001', '1e3', '+1', 'NaN', '1,000', '٣'])('rejects %j', (input) => {
    expect(() => parseUsd(input)).toThrow(MoneyError);
  });

  it('rejects negatives unless allowed', () => {
    expect(() => parseUsd('-1')).toThrow(/negative/);
    expect(parseUsd('-1.5', { allowNegative: true })).toBe(-1_500_000n);
  });

  it('rejects values outside the bigint column range', () => {
    expect(() => parseUsd('9223372036854.775808')).toThrow(/range/);
  });
});

describe('formatUsd', () => {
  it.each([
    [0n, '0.00'],
    [1n, '0.000001'],
    [12_500_000n, '12.50'],
    [-1_230_000n, '-1.23'],
  ])('formats %s', (value, expected) => {
    expect(formatUsd(micros(value))).toBe(expected);
  });

  it('rounds for display half away from zero', () => {
    expect(formatUsdRounded(micros(1_234_999n))).toBe('1.23');
    expect(formatUsdRounded(micros(1_235_000n))).toBe('1.24');
    expect(formatUsdRounded(micros(-1_235_000n))).toBe('-1.24');
    expect(formatUsdRounded(micros(4_000n))).toBe('0.00');
    expect(formatUsdRounded(micros(999_999_500_000n), 0)).toBe('1000000');
  });
});

describe('conversions', () => {
  it('converts cents and 6-decimal stablecoin units exactly', () => {
    expect(fromCents(1_250n)).toBe(12_500_000n);
    expect(fromAtomicUsd(1_000_000n, 6)).toBe(1_000_000n);
    expect(fromAtomicUsd(5n, 2)).toBe(50_000n);
  });

  it('rounds up tokens with more than 6 decimals so spend is never under-counted', () => {
    expect(fromAtomicUsd(1n, 18)).toBe(1n);
    expect(fromAtomicUsd(1_000_000_000_000n, 18)).toBe(1n);
    expect(fromAtomicUsd(1_000_000_000_001n, 18)).toBe(2n);
  });

  it('ceilDiv rounds up', () => {
    expect(ceilDiv(10n, 3n)).toBe(4n);
    expect(ceilDiv(9n, 3n)).toBe(3n);
    expect(ceilDiv(0n, 7n)).toBe(0n);
  });
});

describe('properties', () => {
  const anyMicros = fc.bigInt({ min: -MAX_ABS_MICROS, max: MAX_ABS_MICROS });

  it('INV-5: formatUsd and parseUsd round-trip every representable amount', () => {
    fc.assert(
      fc.property(anyMicros, (value) => {
        expect(parseUsd(formatUsd(micros(value)), { allowNegative: true })).toBe(value);
      }),
    );
  });

  it('fuzz: parseUsd only ever throws MoneyError, and anything it accepts round-trips exactly', () => {
    const numericish = fc.stringMatching(/^-?\d{0,20}(\.\d{0,8})?$/);
    fc.assert(
      fc.property(fc.oneof(fc.string(), numericish), (input) => {
        let value;
        try {
          value = parseUsd(input, { allowNegative: true });
        } catch (error) {
          expect(error).toBeInstanceOf(MoneyError);
          return;
        }
        expect(parseUsd(formatUsd(value), { allowNegative: true })).toBe(value);
      }),
    );
  });

  it('display rounding is within half a cent of the exact value', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), (value) => {
        const rounded = parseUsd(formatUsdRounded(micros(value)));
        const diff = rounded > value ? rounded - value : value - rounded;
        expect(diff <= 5_000n).toBe(true);
      }),
    );
  });
});
