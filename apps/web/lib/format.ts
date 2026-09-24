import { parseUsd } from '@aperture/core';

/**
 * API amounts are exact decimal strings. Grouping the whole part keeps every digit; nothing
 * passes through a float.
 */
export function formatAmount(amount: string, unit: 'micros' | 'count'): string {
  if (unit === 'count') return `${BigInt(amount).toLocaleString('en-US')} actions`;
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  return `${negative ? '-' : ''}$${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}

/** Whole percent of the limit taken by spend plus open holds, clamped to 0–999 for display. */
export function percentUsed(budget: {
  limit: string;
  unit: 'micros' | 'count';
  usage: { spent: string; held: string };
}): number {
  const units = (value: string): bigint =>
    budget.unit === 'count' ? BigInt(value) : parseUsd(value, { allowNegative: true });
  const limit = units(budget.limit);
  const used = units(budget.usage.spent) + units(budget.usage.held);
  if (limit <= 0n) return used > 0n ? 999 : 0;
  const percent = (used * 100n) / limit;
  return Number(percent > 999n ? 999n : percent < 0n ? 0n : percent);
}

/** A timestamp in the org's time zone, which is the zone budgets reset in. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export const roleLabel = (role: string): string => role.replace('_', ' ');
