import type { FetchLike } from './http';

export const PROVIDERS = ['openrouter', 'openai', 'anthropic', 'google', 'huggingface'] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * Enforcement tiers (plan/architecture §13):
 * T1 — the provider enforces a limit Aperture mirrors; T2 — Aperture revokes keys on breach;
 * T3 — visibility only.
 */
export type EnforcementTier = 'T1' | 'T2' | 'T3';

export interface Capabilities {
  /** Aperture can create a key for a principal. */
  createKey: boolean;
  /** Aperture can push a spending limit to a key (T1). */
  setLimit: boolean;
  /** Aperture can disable or delete a key (T2). */
  revoke: boolean;
  /**
   * How usage is read: `key_totals` — each key reports lifetime spend and Aperture imports the
   * difference since the last sync; `buckets` — per-minute usage by key and model, priced from
   * the catalog; `none` — no usage API.
   */
  usage: 'key_totals' | 'buckets' | 'none';
  tier: EnforcementTier;
}

/** A key as it exists at the provider. Amounts are µUSD. */
export interface ExternalKey {
  externalId: string;
  name: string;
  hint: string | null;
  disabled: boolean;
  /** Lifetime spend, for `key_totals` connectors. */
  usage?: bigint;
  limit?: bigint | null;
}

/** Token usage for one key and model in one time bucket (`buckets` connectors). */
export interface UsageRecord {
  externalKeyId: string;
  model: string;
  bucketStart: Date;
  bucketEnd: Date;
  /** Uncached input tokens. */
  inputTokens: bigint;
  outputTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
}

export interface HealthResult {
  /** The provider account id, so one account is connected once per org (C9). */
  fingerprint: string;
  details: Record<string, string | number | boolean>;
}

export interface CreatedKey {
  key: ExternalKey;
  /** The full key, shown to the person once and stored only for gateway-managed keys. */
  secret: string;
}

export interface Connector {
  readonly provider: Provider;
  readonly capabilities: Capabilities;
  test(): Promise<HealthResult>;
  listKeys(): Promise<ExternalKey[]>;
  createKey?(name: string, limit: bigint | null): Promise<CreatedKey>;
  setLimit?(externalId: string, limit: bigint | null): Promise<void>;
  revoke(externalId: string): Promise<void>;
  /** Buckets that start at or after `since`, oldest first. */
  usageSince?(since: Date): Promise<UsageRecord[]>;
}

export interface ConnectorOptions {
  /** The decrypted secret the customer gave us (admin key, management key, service account JSON). */
  secret: string;
  /** Non-secret settings, e.g. the OpenAI project id. */
  config: Record<string, unknown>;
  fetch?: FetchLike | undefined;
  sleep?: (ms: number) => Promise<void>;
}
