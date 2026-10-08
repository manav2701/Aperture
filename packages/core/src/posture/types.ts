import type { Rail } from '../rails';
import type { RuleType } from '../policy/schema';

/*
 * The posture snapshot (plan/phases/phase-11 §11.1): a plain, typed picture of one org's
 * configuration, collected by @aperture/db with aggregate queries that never select secret
 * columns. Checks are pure functions of it. Times are ISO strings; amounts are decimal USD
 * strings, so the snapshot is plain JSON and can be stored with a run.
 */

export interface SnapshotPolicy {
  scope: 'org' | 'team' | 'principal';
  scopeId: string;
  /** Rule types present in the latest version (an invalid document counts as no rules). */
  ruleTypes: RuleType[];
  /** Rails named by `approval_threshold` and `max_amount_per_action` rules; null means every rail. */
  approvalRails: (Rail | null)[];
  perActionRails: (Rail | null)[];
  /** Per-action caps in µUSD as decimal strings, with their rail (null: every rail). */
  perActionCaps: { rail: Rail | null; max: string }[];
  promptLogging: 'off' | 'metadata' | 'full' | null;
}

export interface SnapshotAgent {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'revoked';
  teamId: string | null;
  ownerUserId: string | null;
  ownerIsMember: boolean;
  riskTier: 'low' | 'medium' | 'high' | null;
  /** Newest of: gateway request, ledger entry, card authorization, x402 payment. */
  lastActivityAt: string | null;
  liveKeys: number;
  activeCards: number;
  activeX402: number;
  /** A hard money budget scoped to this agent, or an active mandate with its own budget. */
  hardBudgetOnPath: boolean;
  isSystem: boolean;
  createdAt: string;
}

export interface SnapshotMember {
  userId: string;
  role: 'owner' | 'admin' | 'finance' | 'team_lead' | 'member' | 'auditor';
  twoFactor: boolean;
}

export interface SnapshotApiKey {
  id: string;
  principalId: string;
  name: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface SnapshotConnection {
  id: string;
  provider: string;
  name: string;
  status: 'active' | 'broken' | 'disabled';
  lastError: string | null;
  lastSyncedAt: string | null;
  /** Provider connections sync usage; alert and card connections don't, so freshness doesn't apply. */
  syncs: boolean;
}

export interface SnapshotCredential {
  id: string;
  connectionId: string;
  provider: string;
  name: string;
  principalId: string | null;
  createdByAperture: boolean;
  /** Spend imported for this key in the last 30 days, µUSD decimal string. */
  usage30d: string;
  /** The connector can disable or delete this key on breach (T2). */
  revocable: boolean;
}

export interface SnapshotCard {
  id: string;
  principalId: string;
  kind: 'agent' | 'task';
  status: 'active' | 'inactive' | 'canceled';
  expiresAt: string | null;
  /** Stripe spending_controls hold category limits. */
  hasCategoryControls: boolean;
}

export interface SnapshotX402Account {
  id: string;
  principalId: string;
  status: 'pending_setup' | 'active' | 'revoked';
  /** On-chain allowance and per-payment cap converted to µUSD (stablecoins are 1:1 at 6 decimals). */
  allowance: string;
  maxPerPayment: string;
  /** Remaining budget for the agent across its hard budgets (µUSD), or null without one. */
  remainingBudget: string | null;
}

export interface SnapshotMandate {
  id: string;
  subjectPrincipalId: string;
  subjectStatus: 'active' | 'paused' | 'revoked';
  notBefore: string;
  expiresAt: string;
}

export interface SnapshotBudget {
  id: string;
  scope: 'org' | 'team' | 'principal' | 'mandate';
  scopeId: string | null;
  mode: 'hard' | 'soft';
  unit: 'micros' | 'count';
  alertThresholds: number[];
}

export interface SnapshotSeat {
  id: string;
  toolId: string;
  userId: string | null;
  status: 'active' | 'idle' | 'cancelled';
  payer: 'company' | 'personal_expensed' | 'personal_unexpensed' | 'unknown';
  source: 'connector' | 'receipt' | 'statement' | 'declared' | 'import' | 'manual';
  lastActiveAt: string | null;
  /** Overage or usage-based charges in the last 30 days (µUSD), when the vendor reports them. */
  extraUsage30d: string;
}

export interface PostureSnapshot {
  orgId: string;
  /** When the snapshot was taken (database clock). */
  takenAt: string;
  rails: Record<Rail, boolean>;
  budgets: SnapshotBudget[];
  policies: SnapshotPolicy[];
  agents: SnapshotAgent[];
  members: SnapshotMember[];
  apiKeys: SnapshotApiKey[];
  connections: SnapshotConnection[];
  credentials: SnapshotCredential[];
  /** Spend booked to the `unassigned` principal in the last 30 days, per credential (µUSD). */
  unassignedUsage: { credentialId: string | null; name: string; amount: string }[];
  cards: SnapshotCard[];
  /** Authorizations Stripe approved without asking Aperture, last 30 days. */
  unseenCardAuthorizations: number;
  x402Accounts: SnapshotX402Account[];
  mandates: SnapshotMandate[];
  /** Created-at of the newest unretired org signing key, or null without one. */
  signingKeyCreatedAt: string | null;
  audit: {
    /** null when the chain wasn't verified for this snapshot. */
    chainIntact: boolean | null;
    brokenAtSeq: number | null;
    anchoringEnabled: boolean;
    lastAnchorAt: string | null;
  };
  settings: { requestLogDays: number; idleSeatDays: number; extraUsageAlertConfigured: boolean };
  /** null when not checked. */
  ledgerDrift: boolean | null;
  seats: SnapshotSeat[];
  approvedTools: string[];
  /** Tools members declared or that receipts/statements found, with who uses them. */
  toolsInUse: { toolId: string; userId: string | null; source: string }[];
  declarations: { members: number; confirmedWithin90Days: number };
  telemetry: { codingSeatHolders: number; reporting: number };
}

export const POSTURE_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type PostureSeverity = (typeof POSTURE_SEVERITIES)[number];

export const POSTURE_STATUSES = ['pass', 'fail', 'unknown', 'not_applicable', 'waived'] as const;
export type PostureStatus = (typeof POSTURE_STATUSES)[number];

export type PostureArea =
  | 'spend'
  | 'access'
  | 'keys'
  | 'agents'
  | 'connections'
  | 'cards'
  | 'x402'
  | 'mandates'
  | 'audit'
  | 'data'
  | 'ledger'
  | 'seats'
  | 'tools';

/** What a check result points at, so the dashboard can link to it. */
export interface PostureSubject {
  kind:
    | 'org'
    | 'agent'
    | 'member'
    | 'key'
    | 'connection'
    | 'credential'
    | 'card'
    | 'x402_account'
    | 'mandate'
    | 'budget'
    | 'seat'
    | 'tool';
  id: string;
  label: string;
  /** For team-lead filtering; null when the subject isn't in a team. */
  teamId?: string | null;
}

export interface CheckOutcome {
  status: Exclude<PostureStatus, 'waived'>;
  /** The subjects that fail (for a failing check) or that the check covered (otherwise). */
  subjects?: PostureSubject[];
  detail?: string;
}

export interface PostureCheck {
  id: string;
  title: string;
  severity: PostureSeverity;
  area: PostureArea;
  /** Why the check matters, in one or two sentences. */
  rationale: string;
  /** Dashboard path under /orgs/{orgId} that fixes a failure. */
  fixHref: string;
  /** Related framework controls; empty until mapped with counsel (§11.6). */
  frameworks: string[];
  evaluate: (snapshot: PostureSnapshot, now: Date) => CheckOutcome;
}

export interface PostureWaiver {
  checkId: string;
  /** null waives the whole check; otherwise one subject id. */
  subjectId: string | null;
  expiresAt: string;
}

export interface CheckResult {
  id: string;
  title: string;
  severity: PostureSeverity;
  area: PostureArea;
  status: PostureStatus;
  fixHref: string;
  subjects: PostureSubject[];
  /** Subjects excused by a waiver (still listed, never hidden). */
  waivedSubjects: PostureSubject[];
  detail: string | null;
}

export interface PostureResult {
  catalogueVersion: number;
  /** 0–100. */
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  results: CheckResult[];
}
