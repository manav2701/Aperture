import { Temporal } from 'temporal-polyfill';

/**
 * Budget periods. `day`, `week` (ISO week), and `month` follow the org's IANA timezone, so a
 * Dubai org's day starts at midnight in Dubai. `hour` windows (used for velocity limits) are
 * fixed UTC hours: a local "hour" can last two hours when clocks go back, which would silently
 * double a velocity limit.
 */
export const PERIODS = ['hour', 'day', 'week', 'month', 'none'] as const;
export type Period = (typeof PERIODS)[number];

export class PeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeriodError';
  }
}

export interface PeriodBounds {
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

function toZoned(instant: Date, timeZone: string): Temporal.ZonedDateTime {
  const ms = instant.getTime();
  if (Number.isNaN(ms)) throw new PeriodError('invalid instant');
  try {
    return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timeZone);
  } catch {
    throw new PeriodError(`unknown time zone "${timeZone}"`);
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function periodKey(instant: Date, period: Period, timeZone: string): string {
  if (period === 'none') return 'all';
  if (period === 'hour') {
    toZoned(instant, 'UTC');
    return `H${instant.toISOString().slice(0, 13)}Z`;
  }
  const zoned = toZoned(instant, timeZone);
  switch (period) {
    case 'day':
      return `${pad(zoned.year, 4)}-${pad(zoned.month)}-${pad(zoned.day)}`;
    case 'week': {
      const week = zoned.weekOfYear;
      const year = zoned.yearOfWeek;
      if (week === undefined || year === undefined) throw new PeriodError('ISO week unavailable for this calendar');
      return `${pad(year, 4)}-W${pad(week)}`;
    }
    case 'month':
      return `${pad(zoned.year, 4)}-${pad(zoned.month)}`;
  }
}

const startOf = (date: Temporal.PlainDate, timeZone: string) =>
  new Date(date.toZonedDateTime({ timeZone }).epochMilliseconds);

export function periodBounds(key: string, period: Period, timeZone: string): PeriodBounds {
  if (period === 'none') {
    if (key !== 'all') throw new PeriodError(`invalid key "${key}" for period none`);
    return { start: new Date(-8.64e15), end: new Date(8.64e15) };
  }
  if (!isValidTimeZone(timeZone)) throw new PeriodError(`unknown time zone "${timeZone}"`);

  const invalid = () => new PeriodError(`invalid key "${key}" for period ${period}`);
  try {
    switch (period) {
      case 'hour': {
        const match = /^H(\d{4}-\d{2}-\d{2}T\d{2})Z$/.exec(key);
        if (!match) throw invalid();
        const start = new Date(`${match[1] ?? ''}:00:00.000Z`);
        if (Number.isNaN(start.getTime()) || periodKey(start, 'hour', 'UTC') !== key) throw invalid();
        return { start, end: new Date(start.getTime() + 3_600_000) };
      }
      case 'day': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw invalid();
        const date = Temporal.PlainDate.from(key, { overflow: 'reject' });
        return { start: startOf(date, timeZone), end: startOf(date.add({ days: 1 }), timeZone) };
      }
      case 'week': {
        const match = /^(\d{4})-W(\d{2})$/.exec(key);
        if (!match) throw invalid();
        const year = Number(match[1]);
        const week = Number(match[2]);
        // ISO 8601: week 1 is the week containing January 4th; weeks start on Monday.
        const jan4 = Temporal.PlainDate.from({ year, month: 1, day: 4 });
        const monday = jan4.subtract({ days: jan4.dayOfWeek - 1 }).add({ weeks: week - 1 });
        if (monday.yearOfWeek !== year || week < 1) throw invalid();
        return { start: startOf(monday, timeZone), end: startOf(monday.add({ weeks: 1 }), timeZone) };
      }
      case 'month': {
        if (!/^\d{4}-\d{2}$/.test(key)) throw invalid();
        const first = Temporal.PlainYearMonth.from(key, { overflow: 'reject' }).toPlainDate({ day: 1 });
        return { start: startOf(first, timeZone), end: startOf(first.add({ months: 1 }), timeZone) };
      }
    }
  } catch (error) {
    if (error instanceof PeriodError) throw error;
    throw invalid();
  }
}
