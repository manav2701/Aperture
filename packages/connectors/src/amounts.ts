import { ConnectorError } from './http';

/**
 * Providers report dollars as JSON numbers (OpenRouter `usage: 89.147664652`). Rounding to the
 * nearest µUSD is exact enough: every value we see is far below 2^53 / 10^6.
 */
export function dollarsToMicros(value: unknown, field: string): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) {
    throw new ConnectorError('invalid_response', `${field} is not a valid dollar amount`);
  }
  return BigInt(Math.round(value * 1_000_000));
}

export const microsToDollars = (value: bigint): number => Number(value) / 1_000_000;

/**
 * Exact decimal string × 10^scale as an integer, rounding up (prices must never be under-counted).
 * Returns null for negative or malformed values (OpenRouter uses "-1" for variable-priced routers).
 */
export function decimalToScaled(value: string, scale: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  const kept = fraction.slice(0, scale).padEnd(scale, '0');
  const dropped = fraction.slice(scale);
  const scaled = BigInt(whole) * 10n ** BigInt(scale) + BigInt(kept === '' ? '0' : kept);
  return /[1-9]/.test(dropped) ? scaled + 1n : scaled;
}
