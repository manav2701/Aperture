import type { FetchLike } from '../http';

/*
 * Seat connectors (plan/phases/phase-12 §12.2): read-only views of who holds a seat in an AI
 * product and how much they use it. They never change anything at the vendor.
 */

export const SEAT_PROVIDER_IDS = [
  'seat:cursor',
  'seat:claude_enterprise',
  'seat:claude_code',
  'seat:github_copilot',
  'seat:m365_copilot',
] as const;
export type SeatProvider = (typeof SEAT_PROVIDER_IDS)[number];

export interface SeatRecord {
  /** The vendor's id for the person (user id, login, or email). */
  externalId: string;
  email: string | null;
  name: string | null;
  /** A catalogue plan id (packages/core ai-tools) when the vendor reports one. */
  plan: string | null;
  /** False when the vendor reports the seat as removed or pending cancellation. */
  active: boolean;
  lastActiveAt: Date | null;
  /** Usage-based charges in the current billing cycle (µUSD), when the vendor reports them. */
  extraUsageCycle?: { cycleStart: string; amount: bigint } | undefined;
}

/** A terminal-tool usage breakdown reported by the vendor (Claude Code analytics). */
export interface SeatModelUsage {
  model: string;
  inputTokens: bigint;
  outputTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
  /** µUSD, the vendor's estimate. */
  cost: bigint;
}

export interface SeatDay {
  externalId: string;
  email: string | null;
  /** `YYYY-MM-DD` (UTC). */
  day: string;
  active: boolean;
  requests: number;
  tokens: bigint;
  sessions?: number | undefined;
  models?: SeatModelUsage[] | undefined;
  linesAdded?: number | undefined;
  linesRemoved?: number | undefined;
  commits?: number | undefined;
  pullRequests?: number | undefined;
}

export interface SeatConnector {
  readonly provider: SeatProvider;
  /** The catalogue tool these seats belong to. */
  readonly toolId: string;
  test(): Promise<{ fingerprint: string; details: Record<string, string | number | boolean> }>;
  listSeats(): Promise<SeatRecord[]>;
  /** Daily activity for UTC days in [since, until). Connectors cap the window to what their API allows. */
  usage(since: Date, until: Date): Promise<SeatDay[]>;
}

export interface SeatConnectorOptions {
  secret: string;
  config: Record<string, unknown>;
  fetch?: FetchLike | undefined;
  sleep?: (ms: number) => Promise<void>;
}

/** A stable, non-reversible fingerprint of a credential, so one account is connected once per org. */
export async function credentialFingerprint(prefix: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}:${hex.slice(0, 24)}`;
}

export const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** UTC days from `since` (inclusive) to `until` (exclusive). */
export function daysBetween(since: Date, until: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  while (cursor < until) {
    days.push(utcDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
