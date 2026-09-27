import { ROLES } from '@aperture/core';
import type { PublicJwk } from '@aperture/crypto';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: 'bigint' });
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(', ')})`);

export const RAIL_VALUES = ['gateway', 'provider', 'card', 'x402'] as const;
export const HOLD_STATUSES = ['open', 'settled', 'released', 'expired_reconciling'] as const;
export const EXPIRY_ACTIONS = ['settle', 'release', 'reconcile'] as const;
export const ENTRY_KINDS = [
  'hold',
  'release',
  'capture',
  'unheld_capture',
  'observed',
  'refund',
  'adjustment',
] as const;

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  /** IANA timezone; budget days, weeks, and months follow it. */
  timezone: text('timezone').notNull().default('Asia/Dubai'),
  createdAt: createdAt(),
});

export const principals = pgTable(
  'principals',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    kind: text('kind', { enum: ['user', 'agent'] }).notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'paused', 'revoked'] })
      .notNull()
      .default('active'),
    parentPrincipalId: uuid('parent_principal_id').references((): AnyPgColumn => principals.id),
    /** Set for `user` principals: the person this principal spends as. */
    userId: text('user_id').references((): AnyPgColumn => users.id),
    teamId: uuid('team_id').references((): AnyPgColumn => teams.id),
    /** For agents: the member responsible for it. */
    ownerUserId: text('owner_user_id').references((): AnyPgColumn => users.id),
    description: text('description'),
    /** `unassigned`: the org's catch-all for provider usage from keys not yet mapped to anyone. */
    systemRole: text('system_role', { enum: ['unassigned'] }),
    createdAt: createdAt(),
  },
  (table) => [
    index('principals_org_idx').on(table.orgId),
    unique('principals_org_system_role_unique').on(table.orgId, table.systemRole),
    unique('principals_org_user_unique').on(table.orgId, table.userId),
    check('principals_kind_check', inList('kind', ['user', 'agent'])),
    check('principals_status_check', inList('status', ['active', 'paused', 'revoked'])),
  ],
);

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => budgets.id),
    name: text('name').notNull(),
    /** What the budget belongs to. Principal budgets are found by (scope, scope_id). */
    scope: text('scope', { enum: ['org', 'team', 'principal', 'mandate'] }).notNull(),
    scopeId: uuid('scope_id'),
    /** `micros`: money in µUSD. `count`: number of actions (velocity limits). */
    unit: text('unit', { enum: ['micros', 'count'] })
      .notNull()
      .default('micros'),
    period: text('period', { enum: ['hour', 'day', 'week', 'month', 'none'] }).notNull(),
    limitAmount: money('limit_amount').notNull(),
    mode: text('mode', { enum: ['hard', 'soft'] })
      .notNull()
      .default('hard'),
    /** Rails the budget applies to; empty means every rail. */
    rails: text('rails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Percentages of the limit that trigger alerts, e.g. {50,80,100}. */
    alertThresholds: integer('alert_thresholds')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('budgets_org_idx').on(table.orgId),
    index('budgets_scope_idx').on(table.scope, table.scopeId),
    check('budgets_scope_check', inList('scope', ['org', 'team', 'principal', 'mandate'])),
    check('budgets_unit_check', inList('unit', ['micros', 'count'])),
    check('budgets_period_check', inList('period', ['hour', 'day', 'week', 'month', 'none'])),
    check('budgets_mode_check', inList('mode', ['hard', 'soft'])),
    check('budgets_limit_check', sql`limit_amount >= 0`),
    check('budgets_rails_check', sql`rails <@ array['gateway','provider','card','x402']::text[]`),
  ],
);

export const budgetUsage = pgTable(
  'budget_usage',
  {
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    periodKey: text('period_key').notNull(),
    held: money('held')
      .notNull()
      .default(sql`0`),
    /** Can go below zero when refunds exceed the period's spend. */
    spent: money('spent')
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.budgetId, table.periodKey] }),
    check('budget_usage_held_check', sql`held >= 0`),
  ],
);

export const holds = pgTable(
  'holds',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    rail: text('rail', { enum: RAIL_VALUES }).notNull(),
    amount: money('amount').notNull(),
    status: text('status', { enum: HOLD_STATUSES }).notNull().default('open'),
    onExpiry: text('on_expiry', { enum: EXPIRY_ACTIONS }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    resource: text('resource'),
    externalRef: text('external_ref'),
    /** Budgets and period keys charged at reserve time; settlement always uses these. */
    budgetIds: uuid('budget_ids').array().notNull(),
    periodKeys: text('period_keys').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
    settledAt: timestamp('settled_at', { withTimezone: true, mode: 'date' }),
    settledAmount: money('settled_amount'),
  },
  (table) => [
    unique('holds_idempotency_unique').on(table.orgId, table.idempotencyKey),
    index('holds_expiry_idx').on(table.status, table.expiresAt),
    check('holds_rail_check', inList('rail', RAIL_VALUES)),
    check('holds_status_check', inList('status', HOLD_STATUSES)),
    check('holds_on_expiry_check', inList('on_expiry', EXPIRY_ACTIONS)),
    check('holds_amount_check', sql`amount > 0`),
    check('holds_settled_amount_check', sql`settled_amount is null or settled_amount >= 0`),
    check('holds_paths_check', sql`cardinality(budget_ids) = cardinality(period_keys)`),
  ],
);

/** Append-only journal: a database trigger rejects UPDATE, DELETE, and TRUNCATE. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    kind: text('kind', { enum: ENTRY_KINDS }).notNull(),
    amount: money('amount').notNull(),
    holdId: uuid('hold_id').references(() => holds.id),
    rail: text('rail', { enum: RAIL_VALUES }).notNull(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    resource: text('resource'),
    externalRef: text('external_ref'),
    budgetIds: uuid('budget_ids').array().notNull(),
    periodKeys: text('period_keys').array().notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    unique('ledger_entries_idempotency_unique').on(table.orgId, table.idempotencyKey),
    index('ledger_entries_org_time_idx').on(table.orgId, table.occurredAt),
    index('ledger_entries_hold_idx').on(table.holdId),
    check('ledger_entries_kind_check', inList('kind', ENTRY_KINDS)),
    check('ledger_entries_rail_check', inList('rail', RAIL_VALUES)),
    check('ledger_entries_paths_check', sql`cardinality(budget_ids) = cardinality(period_keys)`),
  ],
);

/** Hash-chained, append-only audit log (plan/architecture §15). */
export const auditEvents = pgTable(
  'audit_events',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    id: uuid('id').notNull().unique(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    subject: text('subject').notNull(),
    data: jsonb('data').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.seq] })],
);

export const auditOrgCounters = pgTable('audit_org_counters', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.id),
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull(),
  lastHash: text('last_hash').notNull(),
});

// ---------------------------------------------------------------------------------------------
// Authentication (Better Auth). Property names are the ones Better Auth expects. These tables
// are global (a person can belong to several orgs), so they have no org_id and no row-level
// security; only the API's auth layer touches them.

const authTimestamp = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: authTimestamp('created_at').notNull().defaultNow(),
  updatedAt: authTimestamp('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: authTimestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: authTimestamp('created_at').notNull().defaultNow(),
    updatedAt: authTimestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: authTimestamp('access_token_expires_at'),
    refreshTokenExpiresAt: authTimestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: authTimestamp('created_at').notNull().defaultNow(),
    updatedAt: authTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('accounts_user_idx').on(table.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: authTimestamp('expires_at').notNull(),
    createdAt: authTimestamp('created_at').notNull().defaultNow(),
    updatedAt: authTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

// ---------------------------------------------------------------------------------------------
// Organizations: teams, members, invitations, policies, connections.

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    name: text('name').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [unique('teams_org_name_unique').on(table.orgId, table.name)],
);

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ROLES }).notNull(),
    teamId: uuid('team_id').references(() => teams.id),
    createdAt: createdAt(),
  },
  (table) => [
    unique('members_org_user_unique').on(table.orgId, table.userId),
    index('members_user_idx').on(table.userId),
    check('members_role_check', inList('role', ROLES)),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /** Lower-cased. Only a verified account with this email can accept. */
    email: text('email').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    teamId: uuid('team_id').references(() => teams.id),
    /** SHA-256 of the token sent by email; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    acceptedBy: text('accepted_by').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('invitations_org_idx').on(table.orgId),
    check('invitations_role_check', inList('role', ROLES)),
    check('invitations_email_lower_check', sql`email = lower(email)`),
  ],
);

/** Versioned policy documents; the highest version for a scope is the active one. */
export const policies = pgTable(
  'policies',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    scope: text('scope', { enum: ['org', 'team', 'principal'] }).notNull(),
    scopeId: uuid('scope_id').notNull(),
    version: integer('version').notNull(),
    /** Stored form (amounts as decimal strings); validated by @aperture/core on write and on use. */
    document: jsonb('document').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    unique('policies_scope_version_unique').on(table.orgId, table.scope, table.scopeId, table.version),
    check('policies_scope_check', inList('scope', ['org', 'team', 'principal'])),
    check('policies_version_check', sql`version >= 1`),
  ],
);

/** Links to external systems (providers, card programs, wallets). Secrets are envelope-encrypted. */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'broken', 'disabled'] })
      .notNull()
      .default('active'),
    /** The provider-side account id, so one provider account is connected once per org. */
    fingerprint: text('fingerprint'),
    /** Envelope-encrypted secret (see @aperture/crypto); never returned by the API. */
    secret: jsonb('secret').notNull(),
    config: jsonb('config').notNull().default({}),
    /** Connector-specific sync position (e.g. the last imported bucket). */
    syncCursor: jsonb('sync_cursor'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    /** Why the last sync or test failed; cleared on success. */
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('connections_fingerprint_unique').on(table.orgId, table.provider, table.fingerprint),
    check('connections_status_check', inList('status', ['active', 'broken', 'disabled'])),
  ],
);

// ---------------------------------------------------------------------------------------------
// Phase 4: provider credentials, prices, alerts

export const CREDENTIAL_STATUSES = ['active', 'disabled', 'revoked'] as const;

/**
 * Keys that exist at a provider (OpenRouter keys, OpenAI service-account keys, Anthropic keys…)
 * mapped to the principal whose spend they carry. `principalId` null means unassigned.
 */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id),
    principalId: uuid('principal_id').references(() => principals.id),
    /** The provider's id for the key (OpenRouter hash, OpenAI key id, Anthropic key id). */
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    /** Displayable start or end of the key, never the whole key. */
    hint: text('hint'),
    status: text('status', { enum: CREDENTIAL_STATUSES }).notNull().default('active'),
    /** Created by Aperture, so Aperture may set limits on it and delete it. */
    createdByAperture: boolean('created_by_aperture').notNull().default(false),
    /** Used by the gateway itself; its usage is already in the ledger, so imports skip it (G11). */
    managedByGateway: boolean('managed_by_gateway').notNull().default(false),
    /** Envelope-encrypted key material; only stored for keys the gateway uses. */
    secret: jsonb('secret'),
    /** Last limit pushed to the provider (µUSD), to skip no-op updates. */
    mirroredLimit: money('mirrored_limit'),
    /** Provider-reported lifetime usage at the last sync (µUSD), for computing deltas. */
    lastUsage: money('last_usage'),
    meta: jsonb('meta').notNull().default({}),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    unique('credentials_connection_external_unique').on(table.connectionId, table.externalId),
    index('credentials_principal_idx').on(table.principalId),
    check('credentials_status_check', inList('status', CREDENTIAL_STATUSES)),
  ],
);

/** Model prices in µUSD per million tokens. Global, not per org. */
export const prices = pgTable(
  'prices',
  {
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputPerMTok: money('input_per_mtok').notNull(),
    outputPerMTok: money('output_per_mtok').notNull(),
    cacheReadPerMTok: money('cache_read_per_mtok'),
    cacheWritePerMTok: money('cache_write_per_mtok'),
    /** `openrouter-api`, or the pricing page URL for curated entries. */
    source: text('source').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.model] })],
);

/** One row per alert, so a threshold alerts once per budget period (de-duplication). */
export const alertLog = pgTable(
  'alert_log',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /** e.g. `budget:<id>:80:<periodKey>` or `revoked:<credentialId>`. */
    dedupeKey: text('dedupe_key').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (table) => [unique('alert_log_dedupe_unique').on(table.orgId, table.dedupeKey)],
);

// ---------------------------------------------------------------------------------------------
// Phase 5: Aperture keys and the gateway request log

/** Keys that agents and members use to call the gateway. Only an HMAC of each key is stored. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    name: text('name').notNull(),
    /** The first 12 characters, e.g. `apk_live_3Fa`, so people can recognise a key. */
    prefix: text('prefix').notNull(),
    /** HMAC-SHA-256(pepper, key), hex. */
    hash: text('hash').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [index('api_keys_principal_idx').on(table.principalId)],
);

/** Metadata of every gateway request; prompts and completions are never stored here. */
export const gatewayRequests = pgTable(
  'gateway_requests',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
    provider: text('provider').notNull(),
    model: text('model'),
    route: text('route').notNull(),
    /** `allowed`, `denied_policy`, `denied_budget`, `denied_inactive`, `upstream_error`, … */
    outcome: text('outcome').notNull(),
    reasons: jsonb('reasons').notNull().default([]),
    status: integer('status'),
    holdId: uuid('hold_id').references(() => holds.id),
    estimated: money('estimated'),
    cost: money('cost'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    stream: boolean('stream').notNull().default(false),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('gateway_requests_org_created_idx').on(table.orgId, table.createdAt)],
);

// ---------------------------------------------------------------------------------------------
// Phase 6: media (images and video)

export const MEDIA_KINDS = ['image', 'video'] as const;
export const MEDIA_JOB_STATUSES = ['running', 'succeeded', 'failed', 'expired_reconciling'] as const;

/** Image and video prices in µUSD (see @aperture/media). Global, not per org. */
export const mediaPrices = pgTable(
  'media_prices',
  {
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    kind: text('kind', { enum: MEDIA_KINDS }).notNull(),
    perImage: money('per_image'),
    perImageTokenPerM: money('per_image_token_per_m'),
    perSecond: money('per_second'),
    skus: jsonb('skus').$type<Record<string, string>>().notNull().default({}),
    source: text('source').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.model, table.kind] })],
);

/**
 * One image or video generation. Outputs live in private object storage under
 * `org/<org>/media/<job>/<n>.<ext>`; only signed URLs ever leave Aperture (G14).
 */
export const mediaJobs = pgTable(
  'media_jobs',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id),
    kind: text('kind', { enum: MEDIA_KINDS }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status', { enum: MEDIA_JOB_STATUSES }).notNull(),
    prompt: text('prompt').notNull(),
    /** Count, size, quality, seconds, resolution, aspect ratio, audio. */
    params: jsonb('params').$type<Record<string, string | number | boolean>>().notNull(),
    holdId: uuid('hold_id').references(() => holds.id),
    estimated: money('estimated').notNull(),
    cost: money('cost'),
    /** The provider's job or operation id, for asynchronous (video) jobs. */
    providerJobId: text('provider_job_id'),
    outputs: jsonb('outputs').$type<{ key: string; contentType: string; bytes: number }[]>().notNull().default([]),
    error: text('error'),
    pollCount: integer('poll_count').notNull().default(0),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('media_jobs_org_created_idx').on(table.orgId, table.createdAt),
    index('media_jobs_pending_idx').on(table.status),
    check('media_jobs_kind_check', inList('kind', MEDIA_KINDS)),
    check('media_jobs_status_check', inList('status', MEDIA_JOB_STATUSES)),
  ],
);

// ---------------------------------------------------------------------------------------------
// Phase 7: approvals, mandates, signing keys

export const APPROVAL_STATUSES = ['pending', 'approved', 'denied', 'expired', 'used'] as const;
export const MANDATE_STATUSES = ['active', 'revoked'] as const;

/**
 * A request that policy sent to a human (plan/architecture §14). Approving issues a one-shot
 * mandate bound to the request's fingerprint; the requester retries with the approval id.
 */
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    requesterPrincipalId: uuid('requester_principal_id')
      .notNull()
      .references(() => principals.id),
    /** SHA-256 of principal, rail and resource: the retry must be the same kind of request. */
    fingerprint: text('fingerprint').notNull(),
    rail: text('rail', { enum: RAIL_VALUES }).notNull(),
    /** `provider:model` for the gateway, merchant for cards, payee for x402. */
    resource: text('resource').notNull(),
    /** The estimate that needed approval (µUSD). */
    amount: money('amount').notNull(),
    purpose: text('purpose').notNull(),
    /** Snapshot shown to approvers: route, reasons, model, estimate. */
    context: jsonb('context').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: APPROVAL_STATUSES }).notNull().default('pending'),
    decidedBy: text('decided_by').references(() => users.id),
    decisionNote: text('decision_note'),
    /** Cap the approver allowed; at most `amount`. */
    approvedAmount: money('approved_amount'),
    mandateId: uuid('mandate_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('approvals_org_status_idx').on(table.orgId, table.status),
    check('approvals_status_check', inList('status', APPROVAL_STATUSES)),
  ],
);

/** Signed, scoped grants of spending authority (plan/architecture §10). */
export const mandates = pgTable(
  'mandates',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => mandates.id),
    /** A person issued it (dashboard) … */
    issuerUserId: text('issuer_user_id').references(() => users.id),
    /** … or an agent issued it to its sub-agent, within its own mandate. */
    issuerPrincipalId: uuid('issuer_principal_id').references(() => principals.id),
    subjectPrincipalId: uuid('subject_principal_id')
      .notNull()
      .references(() => principals.id),
    /** The scope in stored form (@aperture/core mandateScopeSchema input). */
    scope: jsonb('scope').$type<Record<string, unknown>>().notNull(),
    purpose: text('purpose').notNull(),
    /** The mandate's own budget node; reserves add it to the budget path. */
    budgetId: uuid('budget_id').references(() => budgets.id),
    notBefore: timestamp('not_before', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    status: text('status', { enum: MANDATE_STATUSES }).notNull().default('active'),
    kid: text('kid').notNull(),
    jws: text('jws').notNull(),
    approvalId: uuid('approval_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('mandates_subject_idx').on(table.subjectPrincipalId),
    index('mandates_parent_idx').on(table.parentId),
    check('mandates_status_check', inList('status', MANDATE_STATUSES)),
    check('mandates_uses_check', sql`max_uses is null or uses <= max_uses`),
  ],
);

/** Per-org Ed25519 keys that sign mandates; retired keys stay published for verification. */
export const orgSigningKeys = pgTable(
  'org_signing_keys',
  {
    kid: text('kid').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    publicJwk: jsonb('public_jwk').$type<PublicJwk>().notNull(),
    /** Envelope-encrypted PKCS#8 private key. */
    privateKey: jsonb('private_key').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [index('org_signing_keys_org_idx').on(table.orgId)],
);

// ---------------------------------------------------------------------------------------------
// Cards (Phase 8): the org's own Stripe Issuing program; Aperture decides every authorization.

export const CARD_KINDS = ['agent', 'task'] as const;
export const CARD_STATUSES = ['active', 'inactive', 'canceled'] as const;
export const CARD_AUTH_STATUSES = ['pending', 'closed', 'reversed', 'expired'] as const;
/** approved/declined: our real-time answer; unseen: Stripe approved without asking us (K2). */
export const CARD_AUTH_DECISIONS = ['approved', 'declined', 'unseen'] as const;

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    /** Stripe's card id (`ic_…`). Card numbers are never requested or stored (K13). */
    externalId: text('external_id').notNull(),
    kind: text('kind', { enum: CARD_KINDS }).notNull(),
    status: text('status', { enum: CARD_STATUSES }).notNull().default('active'),
    last4: text('last4'),
    currency: text('currency').notNull().default('usd'),
    /** The backstop spending_controls mirrored to Stripe. */
    controls: jsonb('controls').$type<Record<string, unknown>>().notNull().default({}),
    purpose: text('purpose'),
    /** Task cards: the approval (and its one-shot mandate) they were created for. */
    approvalId: uuid('approval_id').references(() => approvals.id),
    mandateId: uuid('mandate_id').references(() => mandates.id),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
    canceledAt: timestamp('canceled_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    unique('cards_external_unique').on(table.connectionId, table.externalId),
    index('cards_principal_idx').on(table.principalId),
    check('cards_kind_check', inList('kind', CARD_KINDS)),
    check('cards_status_check', inList('status', CARD_STATUSES)),
  ],
);

export const cardAuthorizations = pgTable(
  'card_authorizations',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    /** Stripe's authorization id (`iauth_…`). */
    externalId: text('external_id').notNull(),
    status: text('status', { enum: CARD_AUTH_STATUSES }).notNull().default('pending'),
    decision: text('decision', { enum: CARD_AUTH_DECISIONS }).notNull(),
    reasons: jsonb('reasons').$type<unknown[]>().notNull().default([]),
    /** Holds taken for this authorization: the first request and each increment (K4). */
    holdIds: jsonb('hold_ids').$type<string[]>().notNull().default([]),
    requested: money('requested').notNull(),
    currency: text('currency').notNull(),
    merchant: jsonb('merchant').$type<Record<string, string | null>>().notNull(),
    /** Set once the holds are settled against the captured total (when the authorization closes). */
    settledAt: timestamp('settled_at', { withTimezone: true, mode: 'date' }),
    settledAmount: money('settled_amount'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('card_authorizations_external_unique').on(table.orgId, table.externalId),
    index('card_authorizations_card_idx').on(table.cardId),
    check('card_authorizations_status_check', inList('status', CARD_AUTH_STATUSES)),
    check('card_authorizations_decision_check', inList('decision', CARD_AUTH_DECISIONS)),
  ],
);

export const CARD_TX_TYPES = ['capture', 'refund'] as const;

/** Issuing transactions (`ipi_…`): captures and refunds, in µUSD as reported (refunds negative). */
export const cardTransactions = pgTable(
  'card_transactions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    externalId: text('external_id').notNull(),
    authorizationExternalId: text('authorization_external_id'),
    type: text('type', { enum: CARD_TX_TYPES }).notNull(),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    merchant: jsonb('merchant').$type<Record<string, string | null>>().notNull(),
    /** How the ledger took it: settled with its authorization, unheld capture (K7, K11), or refund. */
    ledgerKind: text('ledger_kind'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('card_transactions_external_unique').on(table.orgId, table.externalId),
    index('card_transactions_auth_idx').on(table.orgId, table.authorizationExternalId),
    check('card_transactions_type_check', inList('type', CARD_TX_TYPES)),
  ],
);

/** Stripe event ids already applied (events are at-least-once and unordered, K3). */
export const webhookReceipts = pgTable(
  'webhook_receipts',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    source: text('source').notNull(),
    eventId: text('event_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.source, table.eventId] })],
);

/**
 * Daily FX (K10): µUSD per one major unit of `currency` (e.g. EUR → 1_080_000). Global, like
 * prices; the card hot path reads it and never fetches it.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    currency: text('currency').notNull(),
    day: text('day').notNull(),
    microsPerUnit: money('micros_per_unit').notNull(),
    source: text('source').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.currency, table.day] })],
);
