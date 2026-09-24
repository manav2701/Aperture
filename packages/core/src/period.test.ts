import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PERIODS, PeriodError, isValidTimeZone, periodBounds, periodKey, type Period } from './period';

const at = (iso: string) => new Date(iso);

describe('periodKey', () => {
  it('uses the org timezone for calendar periods', () => {
    // 21:30 UTC on 22 Sep is 01:30 on 23 Sep in Dubai (UTC+4).
    const instant = at('2026-09-22T21:30:00Z');
    expect(periodKey(instant, 'day', 'UTC')).toBe('2026-09-22');
    expect(periodKey(instant, 'day', 'Asia/Dubai')).toBe('2026-09-23');
    expect(periodKey(at('2026-09-30T20:00:00Z'), 'month', 'Asia/Dubai')).toBe('2026-10');
  });

  it('uses ISO week-numbering years', () => {
    expect(periodKey(at('2026-12-31T12:00:00Z'), 'week', 'UTC')).toBe('2026-W53');
    expect(periodKey(at('2027-01-01T12:00:00Z'), 'week', 'UTC')).toBe('2026-W53');
    expect(periodKey(at('2027-01-04T12:00:00Z'), 'week', 'UTC')).toBe('2027-W01');
    expect(periodKey(at('2024-12-30T12:00:00Z'), 'week', 'UTC')).toBe('2025-W01');
  });

  it('keys hours in UTC regardless of timezone', () => {
    expect(periodKey(at('2026-09-23T14:59:59.999Z'), 'hour', 'Asia/Dubai')).toBe('H2026-09-23T14Z');
  });

  it('rejects unknown timezones and invalid dates', () => {
    expect(() => periodKey(at('2026-01-01T00:00:00Z'), 'day', 'Mars/Olympus')).toThrow(PeriodError);
    expect(() => periodKey(new Date(Number.NaN), 'day', 'UTC')).toThrow(PeriodError);
    expect(isValidTimeZone('Asia/Dubai')).toBe(true);
    expect(isValidTimeZone('Asia/Nowhere')).toBe(false);
  });
});

describe('periodBounds', () => {
  it('handles a 23-hour day when clocks go forward (New York, 8 March 2026)', () => {
    const { start, end } = periodBounds('2026-03-08', 'day', 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });

  it('handles a 25-hour day when clocks go back (London, 25 October 2026)', () => {
    const { start, end } = periodBounds('2026-10-25', 'day', 'Europe/London');
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });

  it('computes Dubai months and ISO weeks', () => {
    expect(periodBounds('2026-09', 'month', 'Asia/Dubai').start.toISOString()).toBe('2026-08-31T20:00:00.000Z');
    expect(periodBounds('2026-W39', 'week', 'UTC').start.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it.each([
    ['2026-02-30', 'day'],
    ['2026-13', 'month'],
    ['2026-W54', 'week'],
    ['2026-W00', 'week'],
    ['H2026-09-23T24Z', 'hour'],
    ['yesterday', 'day'],
    ['all', 'day'],
    ['2026-09', 'none'],
  ] as const)('rejects %s for %s', (key, period) => {
    expect(() => periodBounds(key, period, 'UTC')).toThrow(PeriodError);
  });
});

describe('INV-6: periods partition time', () => {
  // Zones chosen for awkward rules: DST in both hemispheres, 30- and 45-minute offsets,
  // and Samoa, which skipped 30 December 2011 entirely.
  const zones = [
    'UTC',
    'Asia/Dubai',
    'America/New_York',
    'Europe/London',
    'Australia/Lord_Howe',
    'Asia/Kathmandu',
    'Asia/Kolkata',
    'America/Sao_Paulo',
    'Pacific/Apia',
  ];
  const instants = fc.date({ min: at('1972-01-01T00:00:00Z'), max: at('2199-12-31T00:00:00Z'), noInvalidDate: true });
  const periods = fc.constantFrom<Period>(...PERIODS.filter((p) => p !== 'none'));

  it('every instant falls in exactly one period, whose bounds contain it and map back to the same key', () => {
    fc.assert(
      fc.property(instants, periods, fc.constantFrom(...zones), (instant, period, zone) => {
        const key = periodKey(instant, period, zone);
        const { start, end } = periodBounds(key, period, zone);
        expect(start.getTime()).toBeLessThanOrEqual(instant.getTime());
        expect(instant.getTime()).toBeLessThan(end.getTime());
        expect(periodKey(start, period, zone)).toBe(key);
        expect(periodKey(new Date(end.getTime() - 1), period, zone)).toBe(key);
        expect(periodKey(end, period, zone)).not.toBe(key);
      }),
      { numRuns: 2_000 },
    );
  });
});
