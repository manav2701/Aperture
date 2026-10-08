import {
  AI_TOOLS,
  policyDocumentSchema,
  seatMonthlyCost,
  type CoverageStatus,
  type PostureSnapshot,
  type Rail,
  type RuleType,
  type SnapshotPolicy,
} from '@aperture/core';
import { GENESIS_HASH, verifyChain } from '@aperture/crypto';
import { sql } from 'drizzle-orm';
import { exportAuditEvents } from './audit';
import type { DbOrTx } from './client';
import { budgetHeadroom, dbNow, verifyCounters } from './ledger';

/*
 * The posture snapshot collector (plan/phases/phase-11 §11.1). Every query is an aggregate over
 * non-secret columns: no `secret`, `private_key`, `delegate_secret`, or key `hash` column is ever
 * selected (a test asserts it on the SQL this module sends). Call inside withOrg for one org.
 */

/** Provider connections whose usage Aperture imports. */
export const PROVIDER_CONNECTIONS = ['openrouter', 'openai', 'anthropic', 'google', 'huggingface'] as const;
const SPEND_KINDS = sql`('capture', 'unheld_capture', 'observed', 'adjustment', 'refund')`;
const signed = sql`case when e.kind = 'refund' then -e.amount else e.amount end`;
const CODING_TOOLS = new Set(AI_TOOLS.filter((tool) => tool.category === 'coding').map((tool) => tool.id));
const AUDIT_BATCH = 5_000;

export interface AuditCheckpoint {
  seq: number;
  hash: string;
}

export interface SnapshotOptions {
  /** Verify the audit chain forward from this checkpoint (from genesis when null). */
  verifyAudit?: { from: AuditCheckpoint | null } | undefined;
  /** Compare budget counters with the ledger (reads every entry: daily runs only). */
  checkLedger?: boolean | undefined;
  /** Whether this deployment anchors audit roots on chain. */
  anchoringEnabled?: boolean | undefined;
  /** Providers whose connector can disable or delete keys it didn't create (T2). */
  revocableProviders?: readonly string[] | undefined;
}

const iso = (value: Date | string | null | undefined) =>
  value === null || value === undefined ? null : new Date(value).toISOString();
const rows = async <T extends Record<string, unknown>>(tx: DbOrTx, query: ReturnType<typeof sql>) =>
  (await tx.execute<T>(query)).rows;

/** The latest policy version per scope, reduced to what checks read. */
async function snapshotPolicies(tx: DbOrTx, orgId: string): Promise<SnapshotPolicy[]> {
  const latest = await rows<{ scope: 'org' | 'team' | 'principal'; scope_id: string; document: unknown }>(
    tx,
    sql`select distinct on (scope, scope_id) scope, scope_id, document from policies
        where org_id = ${orgId} order by scope, scope_id, version desc`,
  );
  return latest.map((row) => {
    const parsed = policyDocumentSchema.safeParse(row.document);
    const rules = parsed.success ? parsed.data.rules : [];
    const types = [...new Set(rules.map((rule) => rule.type))] as RuleType[];
    const approvalRails: (Rail | null)[] = [];
    const perActionRails: (Rail | null)[] = [];
    const perActionCaps: { rail: Rail | null; max: string }[] = [];
    let promptLogging: SnapshotPolicy['promptLogging'] = null;
    for (const rule of rules) {
      if (rule.type === 'approval_threshold') approvalRails.push(rule.rail ?? null);
      if (rule.type === 'max_amount_per_action') {
        perActionRails.push(rule.rail ?? null);
        perActionCaps.push({ rail: rule.rail ?? null, max: rule.max.toString() });
      }
      if (rule.type === 'prompt_logging') promptLogging = rule.level;
    }
    return {
      scope: row.scope,
      scopeId: row.scope_id,
      ruleTypes: types,
      approvalRails,
      perActionRails,
      perActionCaps,
      promptLogging,
    };
  });
}

/** Verifies the audit chain forward from a checkpoint in batches; returns the new checkpoint. */
async function verifyAudit(
  tx: DbOrTx,
  orgId: string,
  from: AuditCheckpoint | null,
): Promise<{ intact: boolean; brokenAtSeq: number | null; checkpoint: AuditCheckpoint | null }> {
  let checkpoint = from;
  for (;;) {
    const fromSeq = (checkpoint?.seq ?? 0) + 1;
    const batch = await exportAuditEvents(tx, orgId, { fromSeq, toSeq: fromSeq + AUDIT_BATCH - 1 });
    if (batch.length === 0) return { intact: true, brokenAtSeq: null, checkpoint };
    const result = verifyChain(batch, { startPrevHash: checkpoint?.hash ?? GENESIS_HASH, startSeq: fromSeq });
    if (!result.ok) return { intact: false, brokenAtSeq: result.seq, checkpoint };
    const last = batch[batch.length - 1];
    if (last === undefined) return { intact: true, brokenAtSeq: null, checkpoint };
    checkpoint = { seq: last.seq, hash: last.hash };
    if (batch.length < AUDIT_BATCH) return { intact: true, brokenAtSeq: null, checkpoint };
  }
}

/** On-chain amounts (atomic units of a `decimals` token) as µUSD for 1:1 USD stablecoins. */
function atomicToMicros(amount: bigint, decimals: number): bigint {
  if (decimals === 6) return amount;
  if (decimals < 6) return amount * 10n ** BigInt(6 - decimals);
  return amount / 10n ** BigInt(decimals - 6);
}

export async function collectPostureSnapshot(
  tx: DbOrTx,
  orgId: string,
  options: SnapshotOptions = {},
): Promise<{ snapshot: PostureSnapshot; auditCheckpoint: AuditCheckpoint | null }> {
  const now = await dbNow(tx);
  const at = sql`${now.toISOString()}::timestamptz`;
  const revocable = new Set(options.revocableProviders ?? []);

  const connections = await rows<{
    id: string;
    provider: string;
    name: string;
    status: 'active' | 'broken' | 'disabled';
    last_error: string | null;
    last_synced_at: Date | null;
  }>(tx, sql`select id, provider, name, status, last_error, last_synced_at from connections where org_id = ${orgId}`);
  const activeProvider = (ids: readonly string[]) =>
    connections.some((c) => c.status === 'active' && ids.includes(c.provider));

  const [gatewayUse] = await rows<{ used: boolean }>(
    tx,
    sql`select exists(select 1 from api_keys where org_id = ${orgId} and revoked_at is null)
           or exists(select 1 from gateway_requests where org_id = ${orgId} and created_at >= ${at} - interval '30 days') as used`,
  );

  const budgets = await rows<{
    id: string;
    scope: 'org' | 'team' | 'principal' | 'mandate';
    scope_id: string | null;
    mode: 'hard' | 'soft';
    unit: 'micros' | 'count';
    alert_thresholds: number[];
  }>(
    tx,
    sql`select id, scope, scope_id, mode, unit, alert_thresholds from budgets where org_id = ${orgId} and archived_at is null`,
  );

  const agents = await rows<{
    id: string;
    name: string;
    status: 'active' | 'paused' | 'revoked';
    team_id: string | null;
    owner_user_id: string | null;
    owner_is_member: boolean;
    risk_tier: 'low' | 'medium' | 'high' | null;
    system_role: string | null;
    created_at: Date;
    live_keys: string;
    active_cards: string;
    active_x402: string;
    hard_budget: boolean;
    last_activity: Date | null;
  }>(
    tx,
    sql`select p.id, p.name, p.status, p.team_id, p.owner_user_id, p.risk_tier, p.system_role, p.created_at,
          exists(select 1 from members m where m.org_id = p.org_id and m.user_id = p.owner_user_id) as owner_is_member,
          (select count(*) from api_keys k where k.principal_id = p.id and k.revoked_at is null
             and (k.expires_at is null or k.expires_at > ${at})) as live_keys,
          (select count(*) from cards c where c.principal_id = p.id and c.status = 'active') as active_cards,
          (select count(*) from x402_accounts x where x.principal_id = p.id and x.status = 'active') as active_x402,
          exists(select 1 from budgets b where b.org_id = p.org_id and b.scope = 'principal' and b.scope_id = p.id
                   and b.mode = 'hard' and b.unit = 'micros' and b.archived_at is null)
            or exists(select 1 from mandates md where md.subject_principal_id = p.id and md.status = 'active'
                   and md.expires_at > ${at} and md.budget_id is not null) as hard_budget,
          greatest(
            (select max(g.created_at) from gateway_requests g where g.principal_id = p.id),
            (select max(e.occurred_at) from ledger_entries e where e.principal_id = p.id),
            (select max(a.created_at) from card_authorizations a where a.principal_id = p.id),
            (select max(xp.created_at) from x402_payments xp where xp.principal_id = p.id)
          ) as last_activity
        from principals p where p.org_id = ${orgId} and p.kind = 'agent'`,
  );

  const members = await rows<{
    user_id: string;
    role: PostureSnapshot['members'][number]['role'];
    two_factor: boolean;
  }>(
    tx,
    sql`select m.user_id, m.role, u.two_factor_enabled as two_factor
        from members m join users u on u.id = m.user_id where m.org_id = ${orgId}`,
  );

  const apiKeys = await rows<{
    id: string;
    principal_id: string;
    name: string;
    expires_at: Date | null;
    last_used_at: Date | null;
    created_at: Date;
  }>(
    tx,
    sql`select id, principal_id, name, expires_at, last_used_at, created_at from api_keys
        where org_id = ${orgId} and revoked_at is null and (expires_at is null or expires_at > ${at})`,
  );

  const credentials = await rows<{
    id: string;
    connection_id: string;
    provider: string;
    name: string;
    principal_id: string | null;
    created_by_aperture: boolean;
    usage30d: string;
  }>(
    tx,
    sql`select c.id, c.connection_id, cn.provider, c.name, c.principal_id, c.created_by_aperture,
          coalesce((select sum(${signed}) from ledger_entries e
                    where e.org_id = c.org_id and e.rail = 'provider' and e.kind in ${SPEND_KINDS}
                      and e.meta->>'credentialId' = c.id::text and e.occurred_at >= ${at} - interval '30 days'), 0)::text as usage30d
        from credentials c join connections cn on cn.id = c.connection_id
        where c.org_id = ${orgId} and c.status <> 'revoked'`,
  );

  const unassigned = await rows<{ credential_id: string | null; name: string; amount: string }>(
    tx,
    sql`select e.meta->>'credentialId' as credential_id, coalesce(max(c.name), 'Unknown key') as name, sum(${signed})::text as amount
        from ledger_entries e
        join principals p on p.id = e.principal_id and p.system_role = 'unassigned'
        left join credentials c on c.id::text = e.meta->>'credentialId'
        where e.org_id = ${orgId} and e.kind in ${SPEND_KINDS} and e.occurred_at >= ${at} - interval '30 days'
        group by 1`,
  );

  const cards = await rows<{
    id: string;
    principal_id: string;
    kind: 'agent' | 'task';
    status: 'active' | 'inactive' | 'canceled';
    expires_at: Date | null;
    has_categories: boolean;
  }>(
    tx,
    sql`select id, principal_id, kind, status, expires_at,
          (controls ? 'allowed_categories' or controls ? 'blocked_categories') as has_categories
        from cards where org_id = ${orgId}`,
  );
  const [unseen] = await rows<{ count: string }>(
    tx,
    sql`select count(*) from card_authorizations where org_id = ${orgId} and decision = 'unseen'
        and created_at >= ${at} - interval '30 days'`,
  );

  const x402 = await rows<{
    id: string;
    principal_id: string;
    status: 'pending_setup' | 'active' | 'revoked';
    allowance: string;
    max_per_payment: string;
    decimals: number;
  }>(
    tx,
    sql`select id, principal_id, status, allowance::text, max_per_payment::text, decimals from x402_accounts where org_id = ${orgId}`,
  );
  const x402Accounts = [];
  for (const account of x402) {
    const headroom =
      account.status === 'active'
        ? await budgetHeadroom(tx, { orgId, principalId: account.principal_id, rail: 'x402' })
        : { remaining: null };
    x402Accounts.push({
      id: account.id,
      principalId: account.principal_id,
      status: account.status,
      allowance: atomicToMicros(BigInt(account.allowance), account.decimals).toString(),
      maxPerPayment: atomicToMicros(BigInt(account.max_per_payment), account.decimals).toString(),
      remainingBudget: headroom.remaining === null ? null : headroom.remaining.toString(),
    });
  }

  const mandates = await rows<{
    id: string;
    subject_principal_id: string;
    subject_status: 'active' | 'paused' | 'revoked';
    not_before: Date;
    expires_at: Date;
  }>(
    tx,
    sql`select md.id, md.subject_principal_id, p.status as subject_status, md.not_before, md.expires_at
        from mandates md join principals p on p.id = md.subject_principal_id
        where md.org_id = ${orgId} and md.status = 'active' and md.expires_at > ${at}`,
  );

  const [signing] = await rows<{ created_at: Date | null }>(
    tx,
    sql`select max(created_at) as created_at from org_signing_keys where org_id = ${orgId} and retired_at is null`,
  );
  const [anchor] = await rows<{ created_at: Date | null }>(
    tx,
    sql`select max(created_at) as created_at from audit_anchors where org_id = ${orgId}`,
  );
  const [settings] = await rows<{ request_log_days: number; idle_seat_days: number; extra_usage_alert: string | null }>(
    tx,
    sql`select request_log_days, idle_seat_days, extra_usage_alert::text from org_settings where org_id = ${orgId}`,
  );

  const seats = await rows<{
    id: string;
    tool_id: string;
    user_id: string | null;
    status: 'active' | 'idle' | 'cancelled';
    payer: PostureSnapshot['seats'][number]['payer'];
    source: PostureSnapshot['seats'][number]['source'];
    last_active_at: Date | null;
    extra30: string;
  }>(
    tx,
    sql`select s.id, s.tool_id, s.user_id, s.status, s.payer, s.source, s.last_active_at,
          coalesce((select sum(d.extra_usage_cost) from seat_usage_daily d
                    where d.seat_id = s.id and d.day >= to_char(${at} - interval '30 days', 'YYYY-MM-DD')), 0)::text as extra30
        from seats s where s.org_id = ${orgId} and s.status <> 'cancelled'`,
  );
  const approved = await rows<{ tool_id: string }>(tx, sql`select tool_id from approved_tools where org_id = ${orgId}`);
  const external = await rows<{ tool_id: string }>(
    tx,
    sql`select distinct tool_id from external_spend where org_id = ${orgId} and status in ('open', 'assigned', 'governed')`,
  );
  const [confirmations] = await rows<{ count: string }>(
    tx,
    sql`select count(*) from tool_confirmations c join members m on m.org_id = c.org_id and m.user_id = c.user_id
        where c.org_id = ${orgId} and c.confirmed_at >= ${at} - interval '90 days'`,
  );
  const reporting = await rows<{ user_id: string }>(
    tx,
    sql`select distinct user_id from tool_usage_daily where org_id = ${orgId}
        and day >= to_char(${at} - interval '30 days', 'YYYY-MM-DD')`,
  );

  const audit = options.verifyAudit === undefined ? null : await verifyAudit(tx, orgId, options.verifyAudit.from);
  const ledgerDrift = options.checkLedger === true ? !(await verifyCounters(tx, orgId)).ok : null;

  const codingHolders = new Set(
    seats.filter((s) => s.user_id !== null && CODING_TOOLS.has(s.tool_id)).map((s) => s.user_id ?? ''),
  );
  const reportingUsers = new Set(reporting.map((r) => r.user_id));

  const snapshot: PostureSnapshot = {
    orgId,
    takenAt: now.toISOString(),
    rails: {
      gateway: gatewayUse?.used === true,
      provider: activeProvider(PROVIDER_CONNECTIONS),
      card: activeProvider(['stripe_issuing']),
      x402: activeProvider(['solana']),
    },
    budgets: budgets.map((b) => ({
      id: b.id,
      scope: b.scope,
      scopeId: b.scope_id,
      mode: b.mode,
      unit: b.unit,
      alertThresholds: b.alert_thresholds,
    })),
    policies: await snapshotPolicies(tx, orgId),
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      teamId: a.team_id,
      ownerUserId: a.owner_user_id,
      ownerIsMember: a.owner_is_member,
      riskTier: a.risk_tier,
      lastActivityAt: iso(a.last_activity),
      liveKeys: Number(a.live_keys),
      activeCards: Number(a.active_cards),
      activeX402: Number(a.active_x402),
      hardBudgetOnPath: a.hard_budget,
      isSystem: a.system_role !== null,
      createdAt: new Date(a.created_at).toISOString(),
    })),
    members: members.map((m) => ({ userId: m.user_id, role: m.role, twoFactor: m.two_factor })),
    apiKeys: apiKeys.map((k) => ({
      id: k.id,
      principalId: k.principal_id,
      name: k.name,
      expiresAt: iso(k.expires_at),
      lastUsedAt: iso(k.last_used_at),
      createdAt: new Date(k.created_at).toISOString(),
    })),
    connections: connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      name: c.name,
      status: c.status,
      lastError: c.last_error,
      lastSyncedAt: iso(c.last_synced_at),
      syncs: (PROVIDER_CONNECTIONS as readonly string[]).includes(c.provider) || c.provider.startsWith('seat:'),
    })),
    credentials: credentials.map((c) => ({
      id: c.id,
      connectionId: c.connection_id,
      provider: c.provider,
      name: c.name,
      principalId: c.principal_id,
      createdByAperture: c.created_by_aperture,
      usage30d: c.usage30d,
      revocable: c.created_by_aperture || revocable.has(c.provider),
    })),
    unassignedUsage: unassigned.map((u) => ({ credentialId: u.credential_id, name: u.name, amount: u.amount })),
    cards: cards.map((c) => ({
      id: c.id,
      principalId: c.principal_id,
      kind: c.kind,
      status: c.status,
      expiresAt: iso(c.expires_at),
      hasCategoryControls: c.has_categories,
    })),
    unseenCardAuthorizations: Number(unseen?.count ?? 0),
    x402Accounts,
    mandates: mandates.map((m) => ({
      id: m.id,
      subjectPrincipalId: m.subject_principal_id,
      subjectStatus: m.subject_status,
      notBefore: new Date(m.not_before).toISOString(),
      expiresAt: new Date(m.expires_at).toISOString(),
    })),
    signingKeyCreatedAt: iso(signing?.created_at),
    audit: {
      chainIntact: audit === null ? null : audit.intact,
      brokenAtSeq: audit?.brokenAtSeq ?? null,
      anchoringEnabled: options.anchoringEnabled === true,
      lastAnchorAt: iso(anchor?.created_at),
    },
    settings: {
      requestLogDays: settings?.request_log_days ?? 90,
      idleSeatDays: settings?.idle_seat_days ?? 30,
      extraUsageAlertConfigured: settings?.extra_usage_alert != null,
    },
    ledgerDrift,
    seats: seats.map((s) => ({
      id: s.id,
      toolId: s.tool_id,
      userId: s.user_id,
      status: s.status,
      payer: s.payer,
      source: s.source,
      lastActiveAt: iso(s.last_active_at),
      extraUsage30d: s.extra30,
    })),
    approvedTools: approved.map((a) => a.tool_id),
    toolsInUse: [
      ...seats.map((s) => ({ toolId: s.tool_id, userId: s.user_id, source: s.source })),
      ...external.map((e) => ({ toolId: e.tool_id, userId: null, source: 'statement' })),
    ],
    declarations: { members: members.length, confirmedWithin90Days: Number(confirmations?.count ?? 0) },
    telemetry: {
      codingSeatHolders: codingHolders.size,
      reporting: [...codingHolders].filter((id) => reportingUsers.has(id)).length,
    },
  };
  return { snapshot, auditCheckpoint: audit?.checkpoint ?? options.verifyAudit?.from ?? null };
}

/**
 * Spend per governance status for a period (§11.3). Ledger spend is `enforced` on the gateway,
 * card, and x402 rails and `visible` (or `unassigned`) on imported provider usage. Seats count
 * their monthly cost pro rata: connector and import seats are `visible`, receipts, statements,
 * and declarations `external`. External spend rows are `external` (INV-16, INV-17: none of it
 * comes from or goes to the ledger).
 */
export async function coverageAmounts(
  tx: DbOrTx,
  orgId: string,
  period: { from: Date; to: Date },
): Promise<Record<CoverageStatus, bigint>> {
  const totals: Record<CoverageStatus, bigint> = { enforced: 0n, visible: 0n, unassigned: 0n, external: 0n };
  const ledger = await rows<{ status: CoverageStatus; amount: string }>(
    tx,
    sql`select case when e.rail <> 'provider' then 'enforced'
                    when p.system_role = 'unassigned' then 'unassigned' else 'visible' end as status,
               sum(${signed})::text as amount
        from ledger_entries e join principals p on p.id = e.principal_id
        where e.org_id = ${orgId} and e.kind in ${SPEND_KINDS}
          and e.occurred_at >= ${period.from.toISOString()} and e.occurred_at < ${period.to.toISOString()}
        group by 1`,
  );
  for (const row of ledger) totals[row.status] += BigInt(row.amount);

  const seats = await rows<{
    tool_id: string;
    plan: string | null;
    monthly_cost: string | null;
    source: string;
    created_at: Date;
  }>(
    tx,
    sql`select tool_id, plan, monthly_cost::text, source, created_at from seats
        where org_id = ${orgId} and status <> 'cancelled' and created_at < ${period.to.toISOString()}`,
  );
  const periodMs = period.to.getTime() - period.from.getTime();
  for (const seat of seats) {
    const start = Math.max(period.from.getTime(), new Date(seat.created_at).getTime());
    const overlapMs = Math.max(0, period.to.getTime() - start);
    if (overlapMs === 0 || periodMs <= 0) continue;
    const monthly = seatMonthlyCost({ toolId: seat.tool_id, plan: seat.plan, monthlyCost: seat.monthly_cost });
    // Pro rata on whole minutes against a 30-day month, in integers.
    const share = (monthly * BigInt(Math.floor(overlapMs / 60_000))) / BigInt(30 * 24 * 60);
    totals[seat.source === 'connector' || seat.source === 'import' ? 'visible' : 'external'] += share;
  }

  const fromDay = period.from.toISOString().slice(0, 10);
  const toDay = period.to.toISOString().slice(0, 10);
  const [external] = await rows<{ amount: string }>(
    tx,
    sql`select coalesce(sum(amount), 0)::text as amount from external_spend
        where org_id = ${orgId} and status in ('open', 'assigned', 'governed')
          and occurred_on >= ${fromDay} and occurred_on < ${toDay}`,
  );
  totals.external += BigInt(external?.amount ?? '0');
  return totals;
}

export type InventoryKind =
  | 'agent'
  | 'person'
  | 'gateway_key'
  | 'provider_key'
  | 'connection'
  | 'model'
  | 'card'
  | 'x402_account'
  | 'mandate'
  | 'seat'
  | 'external_tool';

export interface InventoryRow {
  kind: InventoryKind;
  id: string;
  name: string;
  owner: string | null;
  teamId: string | null;
  status: CoverageStatus;
  lastActivityAt: string | null;
  /** µUSD over the last 30 days (seats: monthly cost). */
  spend30d: string;
  detail: string | null;
}

/** One row per thing that can spend, with its governance status (§11.3). */
export async function inventoryRows(tx: DbOrTx, orgId: string): Promise<InventoryRow[]> {
  const now = await dbNow(tx);
  const at = sql`${now.toISOString()}::timestamptz`;
  const since = sql`${at} - interval '30 days'`;
  const out: InventoryRow[] = [];

  const principals = await rows<{
    id: string;
    kind: 'user' | 'agent';
    name: string;
    team_id: string | null;
    system_role: string | null;
    owner: string | null;
    gateway_spend: string;
    provider_spend: string;
    live_keys: string;
    last_activity: Date | null;
  }>(
    tx,
    sql`select p.id, p.kind, p.name, p.team_id, p.system_role,
          coalesce(owner.name, owner.email) as owner,
          coalesce((select sum(${signed}) from ledger_entries e where e.principal_id = p.id and e.rail <> 'provider'
                    and e.kind in ${SPEND_KINDS} and e.occurred_at >= ${since}), 0)::text as gateway_spend,
          coalesce((select sum(${signed}) from ledger_entries e where e.principal_id = p.id and e.rail = 'provider'
                    and e.kind in ${SPEND_KINDS} and e.occurred_at >= ${since}), 0)::text as provider_spend,
          (select count(*) from api_keys k where k.principal_id = p.id and k.revoked_at is null) as live_keys,
          (select max(e.occurred_at) from ledger_entries e where e.principal_id = p.id) as last_activity
        from principals p
        left join users owner on owner.id = coalesce(p.owner_user_id, p.user_id)
        where p.org_id = ${orgId} and p.status <> 'revoked'`,
  );
  for (const p of principals) {
    const gateway = BigInt(p.gateway_spend);
    const provider = BigInt(p.provider_spend);
    if (p.kind === 'user' && gateway + provider === 0n && Number(p.live_keys) === 0) continue;
    out.push({
      kind: p.kind === 'agent' ? 'agent' : 'person',
      id: p.id,
      name: p.name,
      owner: p.owner,
      teamId: p.team_id,
      status:
        p.system_role === 'unassigned'
          ? 'unassigned'
          : gateway > 0n || Number(p.live_keys) > 0 || provider === 0n
            ? 'enforced'
            : 'visible',
      lastActivityAt: iso(p.last_activity),
      spend30d: (gateway + provider).toString(),
      detail: p.system_role === 'unassigned' ? 'provider usage on keys nobody claimed' : null,
    });
  }

  const keys = await rows<{
    id: string;
    name: string;
    prefix: string;
    principal: string;
    team_id: string | null;
    last_used_at: Date | null;
  }>(
    tx,
    sql`select k.id, k.name, k.prefix, p.name as principal, p.team_id, k.last_used_at
        from api_keys k join principals p on p.id = k.principal_id
        where k.org_id = ${orgId} and k.revoked_at is null`,
  );
  for (const k of keys)
    out.push({
      kind: 'gateway_key',
      id: k.id,
      name: `${k.prefix}… ${k.name}`,
      owner: k.principal,
      teamId: k.team_id,
      status: 'enforced',
      lastActivityAt: iso(k.last_used_at),
      spend30d: '0',
      detail: null,
    });

  const credentials = await rows<{
    id: string;
    name: string;
    provider: string;
    principal: string | null;
    team_id: string | null;
    managed: boolean;
    spend: string;
  }>(
    tx,
    sql`select c.id, c.name, cn.provider, p.name as principal, p.team_id, c.managed_by_gateway as managed,
          coalesce((select sum(${signed}) from ledger_entries e where e.org_id = c.org_id and e.rail = 'provider'
                    and e.kind in ${SPEND_KINDS} and e.meta->>'credentialId' = c.id::text and e.occurred_at >= ${since}), 0)::text as spend
        from credentials c join connections cn on cn.id = c.connection_id left join principals p on p.id = c.principal_id
        where c.org_id = ${orgId} and c.status <> 'revoked'`,
  );
  for (const c of credentials)
    out.push({
      kind: 'provider_key',
      id: c.id,
      name: c.name,
      owner: c.principal,
      teamId: c.team_id,
      status: c.managed ? 'enforced' : c.principal === null ? 'unassigned' : 'visible',
      lastActivityAt: null,
      spend30d: c.spend,
      detail: c.provider,
    });

  const connections = await rows<{
    id: string;
    name: string;
    provider: string;
    status: string;
    last_synced_at: Date | null;
  }>(
    tx,
    sql`select id, name, provider, status, last_synced_at from connections
        where org_id = ${orgId} and provider not in ('slack', 'slack_app')`,
  );
  for (const c of connections)
    out.push({
      kind: 'connection',
      id: c.id,
      name: c.name,
      owner: null,
      teamId: null,
      status: c.provider === 'stripe_issuing' || c.provider === 'solana' ? 'enforced' : 'visible',
      lastActivityAt: iso(c.last_synced_at),
      spend30d: '0',
      detail: `${c.provider} · ${c.status}`,
    });

  const models = await rows<{ model: string; rail: string; spend: string; last: Date }>(
    tx,
    sql`select coalesce(e.meta->>'model', split_part(e.resource, ':', 2)) as model, e.rail,
          sum(${signed})::text as spend, max(e.occurred_at) as last
        from ledger_entries e
        where e.org_id = ${orgId} and e.kind in ${SPEND_KINDS} and e.occurred_at >= ${since}
          and e.rail in ('gateway', 'provider') and coalesce(e.meta->>'model', split_part(e.resource, ':', 2)) <> ''
        group by 1, 2`,
  );
  for (const m of models)
    out.push({
      kind: 'model',
      id: `${m.rail}:${m.model}`,
      name: m.model,
      owner: null,
      teamId: null,
      status: m.rail === 'gateway' ? 'enforced' : 'visible',
      lastActivityAt: iso(m.last),
      spend30d: m.spend,
      detail: m.rail,
    });

  const cards = await rows<{
    id: string;
    kind: string;
    last4: string | null;
    principal: string;
    team_id: string | null;
  }>(
    tx,
    sql`select c.id, c.kind, c.last4, p.name as principal, p.team_id from cards c join principals p on p.id = c.principal_id
        where c.org_id = ${orgId} and c.status = 'active'`,
  );
  for (const c of cards)
    out.push({
      kind: 'card',
      id: c.id,
      name: `${c.kind} card${c.last4 === null ? '' : ` ••${c.last4}`}`,
      owner: c.principal,
      teamId: c.team_id,
      status: 'enforced',
      lastActivityAt: null,
      spend30d: '0',
      detail: null,
    });

  const accounts = await rows<{ id: string; network: string; principal: string; team_id: string | null }>(
    tx,
    sql`select x.id, x.network, p.name as principal, p.team_id from x402_accounts x join principals p on p.id = x.principal_id
        where x.org_id = ${orgId} and x.status = 'active'`,
  );
  for (const a of accounts)
    out.push({
      kind: 'x402_account',
      id: a.id,
      name: 'Crypto budget account',
      owner: a.principal,
      teamId: a.team_id,
      status: 'enforced',
      lastActivityAt: null,
      spend30d: '0',
      detail: a.network,
    });

  const mandates = await rows<{
    id: string;
    purpose: string;
    principal: string;
    team_id: string | null;
    expires_at: Date;
  }>(
    tx,
    sql`select md.id, md.purpose, p.name as principal, p.team_id, md.expires_at
        from mandates md join principals p on p.id = md.subject_principal_id
        where md.org_id = ${orgId} and md.status = 'active' and md.expires_at > ${at}`,
  );
  for (const m of mandates)
    out.push({
      kind: 'mandate',
      id: m.id,
      name: m.purpose,
      owner: m.principal,
      teamId: m.team_id,
      status: 'enforced',
      lastActivityAt: null,
      spend30d: '0',
      detail: `expires ${new Date(m.expires_at).toISOString().slice(0, 10)}`,
    });

  const seatRows = await rows<{
    id: string;
    tool_id: string;
    plan: string | null;
    monthly_cost: string | null;
    source: string;
    payer: string;
    holder: string | null;
    team_id: string | null;
    last_active_at: Date | null;
  }>(
    tx,
    sql`select s.id, s.tool_id, s.plan, s.monthly_cost::text, s.source, s.payer,
          coalesce(u.name, u.email, s.external_user_ref) as holder, m.team_id, s.last_active_at
        from seats s left join users u on u.id = s.user_id
        left join members m on m.org_id = s.org_id and m.user_id = s.user_id
        where s.org_id = ${orgId} and s.status <> 'cancelled'`,
  );
  for (const s of seatRows) {
    const tool = AI_TOOLS.find((t) => t.id === s.tool_id);
    out.push({
      kind: 'seat',
      id: s.id,
      name: `${tool?.product ?? s.tool_id}${s.plan === null ? '' : ` · ${tool?.plans.find((p) => p.id === s.plan)?.name ?? s.plan}`}`,
      owner: s.holder,
      teamId: s.team_id,
      status: s.source === 'connector' || s.source === 'import' ? 'visible' : 'external',
      lastActivityAt: iso(s.last_active_at),
      spend30d: seatMonthlyCost({ toolId: s.tool_id, plan: s.plan, monthlyCost: s.monthly_cost }).toString(),
      detail: `${s.source} · ${s.payer.replace('_', ' ')}`,
    });
  }

  const externalTools = await rows<{ tool_id: string; vendor: string; spend: string; last: string; rows: string }>(
    tx,
    sql`select tool_id, max(vendor) as vendor, sum(amount)::text as spend, max(occurred_on) as last, count(*)::text as rows
        from external_spend where org_id = ${orgId} and status in ('open', 'assigned', 'governed')
          and occurred_on >= to_char(${since}, 'YYYY-MM-DD')
        group by tool_id`,
  );
  for (const e of externalTools)
    out.push({
      kind: 'external_tool',
      id: e.tool_id,
      name: AI_TOOLS.find((t) => t.id === e.tool_id)?.product ?? e.tool_id,
      owner: null,
      teamId: null,
      status: 'external',
      lastActivityAt: `${e.last}T00:00:00.000Z`,
      spend30d: e.spend,
      detail: `${e.rows} charge(s) on statements · ${e.vendor}`,
    });

  return out;
}
