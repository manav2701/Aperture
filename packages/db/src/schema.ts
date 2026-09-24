import { ROLES } from '@aperture/core';
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
    createdAt: createdAt(),
  },
  (table) => [
    index('principals_org_idx').on(table.orgId),
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
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('connections_fingerprint_unique').on(table.orgId, table.provider, table.fingerprint),
    check('connections_status_check', inList('status', ['active', 'broken', 'disabled'])),
  ],
);
