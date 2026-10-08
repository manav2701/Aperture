import type { Rail } from '../rails';
import type { RuleType } from '../policy/schema';
import type {
  CheckOutcome,
  PostureCheck,
  PostureSnapshot,
  PostureSubject,
  SnapshotAgent,
  SnapshotPolicy,
} from './types';

/*
 * Posture catalogue v1 (plan/phases/phase-11 §11.1, phase-12 §12.7). Every check reads only the
 * snapshot. Thresholds are the plan's defaults (VERIFY with the design partner, then make them
 * org settings). A check that can't see its data answers `unknown`, which scores as a failure:
 * a governance product doesn't say "fine" when it can't see.
 */

export const POSTURE_CATALOGUE_VERSION = 1;

const DAY_MS = 86_400_000;
const PRIVILEGED = new Set(['owner', 'admin', 'finance']);

const daysSince = (iso: string | null, now: Date) =>
  iso === null ? Number.POSITIVE_INFINITY : (now.getTime() - Date.parse(iso)) / DAY_MS;

const pass = (subjects: PostureSubject[] = [], detail?: string): CheckOutcome =>
  detail === undefined ? { status: 'pass', subjects } : { status: 'pass', subjects, detail };
const fail = (subjects: PostureSubject[], detail?: string): CheckOutcome =>
  detail === undefined ? { status: 'fail', subjects } : { status: 'fail', subjects, detail };
const notApplicable = (detail: string): CheckOutcome => ({ status: 'not_applicable', subjects: [], detail });
const failIfAny = (subjects: PostureSubject[], detail?: string) =>
  subjects.length === 0 ? pass() : fail(subjects, detail);

const orgSubject = (s: PostureSnapshot): PostureSubject => ({ kind: 'org', id: s.orgId, label: 'Organization' });
const agentSubject = (a: SnapshotAgent): PostureSubject => ({
  kind: 'agent',
  id: a.id,
  label: a.name,
  teamId: a.teamId,
});

/** Active, non-system agents: the ones checks reason about. */
const liveAgents = (s: PostureSnapshot) => s.agents.filter((a) => a.status === 'active' && !a.isSystem);

/** The policy layers that apply to a principal: org, its team, itself. */
function layersFor(s: PostureSnapshot, principalId: string): SnapshotPolicy[] {
  const teamId = s.agents.find((a) => a.id === principalId)?.teamId ?? null;
  return s.policies.filter(
    (p) =>
      p.scope === 'org' ||
      (p.scope === 'team' && teamId !== null && p.scopeId === teamId) ||
      (p.scope === 'principal' && p.scopeId === principalId),
  );
}

const hasRule = (layers: SnapshotPolicy[], type: RuleType) => layers.some((p) => p.ruleTypes.includes(type));

const coversRail = (rails: (Rail | null)[], rail: Rail) => rails.some((r) => r === null || r === rail);

const usd = (value: string) => {
  // µUSD decimal strings in the snapshot are integers; compare as bigint, never as floats.
  return BigInt(value);
};

export const POSTURE_CATALOGUE: readonly PostureCheck[] = [
  {
    id: 'spend.org_root_hard',
    title: 'The organization has a hard root budget',
    severity: 'critical',
    area: 'spend',
    rationale: 'Without a hard org-wide money budget, nothing caps total spend if every other limit is missing.',
    fixHref: '/budgets',
    frameworks: [],
    evaluate: (s) =>
      s.budgets.some((b) => b.scope === 'org' && b.unit === 'micros' && b.mode === 'hard')
        ? pass([orgSubject(s)])
        : fail([orgSubject(s)], 'no hard money budget at org scope'),
  },
  {
    id: 'spend.agent_capped',
    title: 'Every active agent has its own hard budget',
    severity: 'critical',
    area: 'spend',
    rationale: 'An agent can loop thousands of times an hour; its own hard budget (or a mandate budget) stops it.',
    fixHref: '/budgets',
    frameworks: [],
    evaluate: (s) => {
      const agents = liveAgents(s);
      if (agents.length === 0) return notApplicable('no active agents');
      return failIfAny(agents.filter((a) => !a.hardBudgetOnPath).map(agentSubject));
    },
  },
  {
    id: 'spend.soft_without_alerts',
    title: 'Soft budgets have alert thresholds',
    severity: 'medium',
    area: 'spend',
    rationale: 'A soft budget never blocks; without alerts nobody hears that it was exceeded.',
    fixHref: '/budgets',
    frameworks: [],
    evaluate: (s) => {
      const soft = s.budgets.filter((b) => b.mode === 'soft' && b.unit === 'micros');
      if (soft.length === 0) return notApplicable('no soft budgets');
      return failIfAny(
        soft
          .filter((b) => b.alertThresholds.length === 0)
          .map((b) => ({ kind: 'budget' as const, id: b.id, label: `${b.scope} budget` })),
      );
    },
  },
  {
    id: 'spend.approval_threshold_card_x402',
    title: 'Card and crypto payments above a threshold need approval',
    severity: 'high',
    area: 'spend',
    rationale: 'Cards and x402 move real money outside AI providers; large ones should wait for a person.',
    fixHref: '/policies',
    frameworks: [],
    evaluate: (s) => {
      const rails = (['card', 'x402'] as const).filter((r) => s.rails[r]);
      if (rails.length === 0) return notApplicable('cards and crypto are not set up');
      const org = s.policies.filter((p) => p.scope === 'org');
      const approval = org.flatMap((p) => p.approvalRails);
      const missing = rails.filter((r) => !coversRail(approval, r));
      return missing.length === 0
        ? pass([orgSubject(s)])
        : fail([orgSubject(s)], `no org approval_threshold for ${missing.join(' and ')}`);
    },
  },
  {
    id: 'spend.per_action_cap_agents',
    title: 'Agents have a per-action spending cap',
    severity: 'high',
    area: 'spend',
    rationale: 'A per-action cap stops a single runaway call or purchase, even inside the budget.',
    fixHref: '/policies',
    frameworks: [],
    evaluate: (s) => {
      const agents = liveAgents(s);
      if (agents.length === 0) return notApplicable('no active agents');
      return failIfAny(agents.filter((a) => !hasRule(layersFor(s, a.id), 'max_amount_per_action')).map(agentSubject));
    },
  },
  {
    id: 'spend.model_allowlist',
    title: 'A model allow or deny list exists',
    severity: 'low',
    area: 'spend',
    rationale: 'Pinning which models may be used stops surprise use of the most expensive ones.',
    fixHref: '/policies',
    frameworks: [],
    evaluate: (s) => {
      if (!s.rails.gateway && !s.rails.provider) return notApplicable('no AI provider or gateway use yet');
      return s.policies.some((p) => p.ruleTypes.includes('allow_models') || p.ruleTypes.includes('deny_models'))
        ? pass()
        : fail([orgSubject(s)], 'no allow_models or deny_models rule');
    },
  },
  {
    id: 'access.privileged_2fa',
    title: 'Owners, admins, and finance use two-factor authentication',
    severity: 'critical',
    area: 'access',
    rationale: 'These roles can change budgets and approve spend; a stolen password alone must not be enough.',
    fixHref: '/settings/members',
    frameworks: [],
    evaluate: (s) =>
      failIfAny(
        s.members
          .filter((m) => PRIVILEGED.has(m.role) && !m.twoFactor)
          .map((m) => ({ kind: 'member' as const, id: m.userId, label: m.role })),
      ),
  },
  {
    id: 'access.owner_count',
    title: 'There are two or three owners',
    severity: 'medium',
    area: 'access',
    rationale: 'One owner is a single point of failure; more than three is sprawl.',
    fixHref: '/settings/members',
    frameworks: [],
    evaluate: (s) => {
      const owners = s.members.filter((m) => m.role === 'owner').length;
      return owners >= 2 && owners <= 3
        ? pass([orgSubject(s)])
        : fail([orgSubject(s)], `${String(owners)} owner${owners === 1 ? '' : 's'}`);
    },
  },
  {
    id: 'access.agent_has_owner',
    title: 'Every agent has an owner who is still a member',
    severity: 'high',
    area: 'access',
    rationale: 'Someone must be accountable for each agent, and leaving the org must not orphan it.',
    fixHref: '/agents',
    frameworks: [],
    evaluate: (s) => {
      const agents = liveAgents(s);
      if (agents.length === 0) return notApplicable('no active agents');
      return failIfAny(agents.filter((a) => a.ownerUserId === null || !a.ownerIsMember).map(agentSubject));
    },
  },
  {
    id: 'keys.expiry_set',
    title: 'Gateway keys have an expiry',
    severity: 'medium',
    area: 'keys',
    rationale: 'Keys without an expiry outlive the project they were made for.',
    fixHref: '/agents',
    frameworks: [],
    evaluate: (s) => {
      if (s.apiKeys.length === 0) return notApplicable('no live gateway keys');
      return failIfAny(
        s.apiKeys.filter((k) => k.expiresAt === null).map((k) => ({ kind: 'key' as const, id: k.id, label: k.name })),
      );
    },
  },
  {
    id: 'keys.idle_live',
    title: 'No live key has been unused for 30 days',
    severity: 'high',
    area: 'keys',
    rationale: 'An unused live key is all risk and no value: revoke it.',
    fixHref: '/agents',
    frameworks: [],
    evaluate: (s, now) => {
      if (s.apiKeys.length === 0) return notApplicable('no live gateway keys');
      return failIfAny(
        s.apiKeys
          .filter((k) => daysSince(k.lastUsedAt ?? k.createdAt, now) >= 30)
          .map((k) => ({ kind: 'key' as const, id: k.id, label: k.name })),
      );
    },
  },
  {
    id: 'keys.age',
    title: 'No live key is older than 90 days',
    severity: 'medium',
    area: 'keys',
    rationale: 'Rotating keys limits how long a leaked key stays useful.',
    fixHref: '/agents',
    frameworks: [],
    evaluate: (s, now) => {
      if (s.apiKeys.length === 0) return notApplicable('no live gateway keys');
      return failIfAny(
        s.apiKeys
          .filter((k) => daysSince(k.createdAt, now) > 90)
          .map((k) => ({ kind: 'key' as const, id: k.id, label: k.name })),
      );
    },
  },
  {
    id: 'agents.idle_with_credentials',
    title: 'Idle agents hold no keys, cards, or crypto allowances',
    severity: 'high',
    area: 'agents',
    rationale: 'An agent unused for 30 days that can still spend is an easy target.',
    fixHref: '/agents',
    frameworks: [],
    evaluate: (s, now) => {
      const agents = liveAgents(s);
      if (agents.length === 0) return notApplicable('no active agents');
      return failIfAny(
        agents
          .filter((a) => a.liveKeys + a.activeCards + a.activeX402 > 0)
          .filter((a) => daysSince(a.lastActivityAt ?? a.createdAt, now) >= 30)
          .map(agentSubject),
      );
    },
  },
  {
    id: 'agents.high_risk_hard_capped',
    title: 'High-risk agents have a hard budget and an approval threshold',
    severity: 'high',
    area: 'agents',
    rationale: 'Agents an admin marked high risk should never spend large amounts without a person.',
    fixHref: '/agents',
    frameworks: [],
    evaluate: (s) => {
      const high = liveAgents(s).filter((a) => a.riskTier === 'high');
      if (high.length === 0) return notApplicable('no agents marked high risk');
      return failIfAny(
        high.filter((a) => !a.hardBudgetOnPath || !hasRule(layersFor(s, a.id), 'approval_threshold')).map(agentSubject),
      );
    },
  },
  {
    id: 'conn.healthy',
    title: 'Connections are healthy and synced in the last 24 hours',
    severity: 'high',
    area: 'connections',
    rationale: 'A broken connection means spend there is neither tracked nor enforced.',
    fixHref: '/connections',
    frameworks: [],
    evaluate: (s, now) => {
      if (s.connections.length === 0) return notApplicable('no connections');
      return failIfAny(
        s.connections
          .filter(
            (c) => c.status !== 'active' || c.lastError !== null || (c.syncs && daysSince(c.lastSyncedAt, now) > 1),
          )
          .map((c) => ({ kind: 'connection' as const, id: c.id, label: c.name })),
      );
    },
  },
  {
    id: 'conn.unassigned_usage',
    title: 'No provider spend went to unassigned keys',
    severity: 'high',
    area: 'connections',
    rationale: 'Spend on a key nobody claimed is spend nobody owns: shadow AI inside a connected account.',
    fixHref: '/shadow-ai',
    frameworks: [],
    evaluate: (s) => {
      if (!s.rails.provider) return notApplicable('no provider connections');
      return failIfAny(
        s.unassignedUsage
          .filter((u) => usd(u.amount) > 0n)
          .map((u) => ({ kind: 'credential' as const, id: u.credentialId ?? 'unknown', label: u.name })),
      );
    },
  },
  {
    id: 'conn.enforceable',
    title: 'Keys with spend can be limited or revoked',
    severity: 'medium',
    area: 'connections',
    rationale: 'Aperture can only stop spend on keys it created or can revoke at the provider.',
    fixHref: '/connections',
    frameworks: [],
    evaluate: (s) => {
      const used = s.credentials.filter((c) => usd(c.usage30d) > 0n);
      if (used.length === 0) return notApplicable('no provider keys with recent spend');
      return failIfAny(
        used
          .filter((c) => !c.createdByAperture && !c.revocable)
          .map((c) => ({ kind: 'credential' as const, id: c.id, label: c.name })),
      );
    },
  },
  {
    id: 'cards.merchant_rule',
    title: 'Every active card is limited to merchant categories',
    severity: 'high',
    area: 'cards',
    rationale: 'A card an agent holds should only work where the agent is meant to buy.',
    fixHref: '/cards',
    frameworks: [],
    evaluate: (s) => {
      const active = s.cards.filter((c) => c.status === 'active');
      if (active.length === 0) return notApplicable('no active cards');
      return failIfAny(
        active
          .filter((c) => !c.hasCategoryControls && !hasRule(layersFor(s, c.principalId), 'merchant_categories'))
          .map((c) => ({ kind: 'card' as const, id: c.id, label: `${c.kind} card` })),
      );
    },
  },
  {
    id: 'cards.task_expired_active',
    title: 'No task card is active after it expired',
    severity: 'high',
    area: 'cards',
    rationale: 'A single-use card must stop working when its task ends.',
    fixHref: '/cards',
    frameworks: [],
    evaluate: (s, now) => {
      const task = s.cards.filter((c) => c.kind === 'task');
      if (task.length === 0) return notApplicable('no task cards');
      return failIfAny(
        task
          .filter((c) => c.status === 'active' && c.expiresAt !== null && Date.parse(c.expiresAt) < now.getTime())
          .map((c) => ({ kind: 'card' as const, id: c.id, label: 'task card' })),
      );
    },
  },
  {
    id: 'cards.unseen_auths',
    title: 'Stripe asked Aperture about every card authorization',
    severity: 'critical',
    area: 'cards',
    rationale: 'An authorization approved without asking Aperture bypassed every budget and policy.',
    fixHref: '/cards',
    frameworks: [],
    evaluate: (s) => {
      if (!s.rails.card) return notApplicable('cards are not set up');
      return s.unseenCardAuthorizations === 0
        ? pass()
        : fail(
            [orgSubject(s)],
            `${String(s.unseenCardAuthorizations)} authorization(s) approved by Stripe without Aperture in 30 days`,
          );
    },
  },
  {
    id: 'x402.allowance_within_budget',
    title: 'No crypto allowance exceeds the agent’s remaining budget',
    severity: 'critical',
    area: 'x402',
    rationale:
      'The on-chain allowance is the hard cap Aperture can’t override; it must not exceed what the budget allows.',
    fixHref: '/crypto',
    frameworks: [],
    evaluate: (s) => {
      const active = s.x402Accounts.filter((a) => a.status === 'active');
      if (active.length === 0) return notApplicable('no active crypto accounts');
      return failIfAny(
        active
          .filter((a) => a.remainingBudget === null || usd(a.allowance) > usd(a.remainingBudget))
          .map((a) => ({ kind: 'x402_account' as const, id: a.id, label: 'budget account' })),
      );
    },
  },
  {
    id: 'x402.per_payment_cap',
    title: 'Crypto per-payment caps are within the per-action policy cap',
    severity: 'high',
    area: 'x402',
    rationale: 'The on-chain per-payment cap should never allow more than policy does.',
    fixHref: '/crypto',
    frameworks: [],
    evaluate: (s) => {
      const active = s.x402Accounts.filter((a) => a.status === 'active');
      if (active.length === 0) return notApplicable('no active crypto accounts');
      return failIfAny(
        active
          .filter((a) => {
            const caps = layersFor(s, a.principalId)
              .flatMap((p) => p.perActionCaps)
              .filter((c) => c.rail === null || c.rail === 'x402')
              .map((c) => usd(c.max));
            if (caps.length === 0) return true;
            const tightest = caps.reduce((min, c) => (c < min ? c : min));
            return usd(a.maxPerPayment) > tightest;
          })
          .map((a) => ({ kind: 'x402_account' as const, id: a.id, label: 'budget account' })),
      );
    },
  },
  {
    id: 'x402.payee_allowlist',
    title: 'Agents paying with crypto have a payee allow list',
    severity: 'high',
    area: 'x402',
    rationale: 'A payee list stops an agent paying an address an attacker put in a 402 response.',
    fixHref: '/policies',
    frameworks: [],
    evaluate: (s) => {
      const active = s.x402Accounts.filter((a) => a.status === 'active');
      if (active.length === 0) return notApplicable('no active crypto accounts');
      const principals = [...new Set(active.map((a) => a.principalId))];
      return failIfAny(
        principals
          .filter((id) => !hasRule(layersFor(s, id), 'x402_payees'))
          .map((id) => {
            const agent = s.agents.find((a) => a.id === id);
            return agent === undefined ? { kind: 'agent' as const, id, label: id } : agentSubject(agent);
          }),
      );
    },
  },
  {
    id: 'mandates.bounded_expiry',
    title: 'No active mandate lasts longer than 90 days',
    severity: 'medium',
    area: 'mandates',
    rationale: 'Long-lived grants of authority drift away from the task they were issued for.',
    fixHref: '/agents',
    frameworks: [],
    evaluate: (s) => {
      if (s.mandates.length === 0) return notApplicable('no active mandates');
      return failIfAny(
        s.mandates
          .filter((m) => (Date.parse(m.expiresAt) - Date.parse(m.notBefore)) / DAY_MS > 90)
          .map((m) => ({ kind: 'mandate' as const, id: m.id, label: 'mandate' })),
      );
    },
  },
  {
    id: 'mandates.orphaned',
    title: 'No active mandate belongs to a paused or revoked agent',
    severity: 'high',
    area: 'mandates',
    rationale: 'A mandate should end with the agent it was issued to.',
    fixHref: '/agents',
    frameworks: [],
    evaluate: (s) => {
      if (s.mandates.length === 0) return notApplicable('no active mandates');
      return failIfAny(
        s.mandates
          .filter((m) => m.subjectStatus !== 'active')
          .map((m) => ({ kind: 'mandate' as const, id: m.id, label: 'mandate' })),
      );
    },
  },
  {
    id: 'mandates.key_rotation',
    title: 'The mandate signing key is younger than 12 months',
    severity: 'low',
    area: 'mandates',
    rationale: 'Rotating the signing key yearly limits the damage of an undetected compromise.',
    fixHref: '/settings',
    frameworks: [],
    evaluate: (s, now) => {
      if (s.signingKeyCreatedAt === null) return notApplicable('no signing key yet');
      return daysSince(s.signingKeyCreatedAt, now) <= 365
        ? pass()
        : fail([orgSubject(s)], 'the signing key is over a year old');
    },
  },
  {
    id: 'audit.chain_intact',
    title: 'The audit chain verifies from the start',
    severity: 'critical',
    area: 'audit',
    rationale: 'A broken hash chain means an audit event was changed or removed.',
    fixHref: '/audit',
    frameworks: [],
    evaluate: (s) => {
      if (s.audit.chainIntact === null) return { status: 'unknown', subjects: [], detail: 'not verified in this run' };
      return s.audit.chainIntact
        ? pass()
        : fail([orgSubject(s)], `chain broken at seq ${String(s.audit.brokenAtSeq ?? '?')}`);
    },
  },
  {
    id: 'audit.anchored',
    title: 'The latest audit anchor is under 48 hours old',
    severity: 'medium',
    area: 'audit',
    rationale: 'Anchors prove the chain existed at a point in time; a stale one weakens that proof.',
    fixHref: '/audit',
    frameworks: [],
    evaluate: (s, now) => {
      if (!s.audit.anchoringEnabled) return notApplicable('audit anchoring is off');
      return daysSince(s.audit.lastAnchorAt, now) < 2 ? pass() : fail([orgSubject(s)], 'no anchor in 48 hours');
    },
  },
  {
    id: 'data.prompt_logging_full',
    title: 'No policy stores full prompts without a waiver',
    severity: 'medium',
    area: 'data',
    rationale: 'Full prompt logging keeps sensitive content; it should be a deliberate, recorded choice.',
    fixHref: '/policies',
    frameworks: [],
    evaluate: (s) =>
      failIfAny(
        s.policies
          .filter((p) => p.promptLogging === 'full')
          .map((p) => ({ kind: 'org' as const, id: `${p.scope}:${p.scopeId}`, label: `${p.scope} policy` })),
      ),
  },
  {
    id: 'data.retention',
    title: 'Request logs are kept for a year or less',
    severity: 'low',
    area: 'data',
    rationale: 'Keeping request logs longer than needed increases what a breach exposes.',
    fixHref: '/settings/privacy',
    frameworks: [],
    evaluate: (s) =>
      s.settings.requestLogDays <= 365
        ? pass()
        : fail([orgSubject(s)], `${String(s.settings.requestLogDays)} days of request logs`),
  },
  {
    id: 'ledger.no_drift',
    title: 'Budget counters match the ledger',
    severity: 'critical',
    area: 'ledger',
    rationale: 'If counters drift from the journal, budgets enforce the wrong numbers.',
    fixHref: '/budgets',
    frameworks: [],
    evaluate: (s) => {
      if (s.ledgerDrift === null) return { status: 'unknown', subjects: [], detail: 'not checked in this run' };
      return s.ledgerDrift ? fail([orgSubject(s)], 'budget counters differ from the ledger') : pass();
    },
  },
  // Phase 12: seats, subscriptions, terminal tools.
  {
    id: 'seats.idle',
    title: 'No paid seat has been idle past the idle threshold',
    severity: 'medium',
    area: 'seats',
    rationale: 'Idle seats are money spent on nothing; reclaim them.',
    fixHref: '/seats',
    frameworks: [],
    evaluate: (s, now) => {
      const active = s.seats.filter((seat) => seat.status !== 'cancelled');
      if (active.length === 0) return notApplicable('no seats recorded');
      return failIfAny(
        active
          .filter(
            (seat) =>
              seat.status === 'idle' ||
              ((seat.source === 'connector' || seat.source === 'import') &&
                daysSince(seat.lastActiveAt, now) > s.settings.idleSeatDays),
          )
          .map((seat) => ({ kind: 'seat' as const, id: seat.id, label: seat.toolId })),
      );
    },
  },
  {
    id: 'seats.personal_duplicates',
    title: 'Nobody pays personally for a tool the company already provides',
    severity: 'low',
    area: 'seats',
    rationale: 'A personal plan next to a company seat is double spend and keeps work data outside admin control.',
    fixHref: '/seats',
    frameworks: [],
    evaluate: (s) => {
      const live = s.seats.filter((seat) => seat.status !== 'cancelled' && seat.userId !== null);
      if (live.length === 0) return notApplicable('no seats with a known person');
      const company = new Set(
        live.filter((seat) => seat.payer === 'company').map((seat) => `${seat.userId ?? ''}|${seat.toolId}`),
      );
      return failIfAny(
        live
          .filter((seat) => seat.payer.startsWith('personal') && company.has(`${seat.userId ?? ''}|${seat.toolId}`))
          .map((seat) => ({ kind: 'seat' as const, id: seat.id, label: seat.toolId })),
      );
    },
  },
  {
    id: 'tools.unapproved',
    title: 'Every AI tool in use is on the approved list',
    severity: 'medium',
    area: 'tools',
    rationale: 'An approved-tools list tells people what’s allowed and makes unapproved use visible.',
    fixHref: '/tools',
    frameworks: [],
    evaluate: (s) => {
      if (s.toolsInUse.length === 0) return notApplicable('no AI tools recorded yet');
      if (s.approvedTools.length === 0) return fail([orgSubject(s)], 'no approved-tools list');
      const approved = new Set(s.approvedTools);
      const unapproved = [...new Set(s.toolsInUse.filter((t) => !approved.has(t.toolId)).map((t) => t.toolId))];
      return failIfAny(unapproved.map((toolId) => ({ kind: 'tool' as const, id: toolId, label: toolId })));
    },
  },
  {
    id: 'tools.declaration_fresh',
    title: 'Most members confirmed their AI tools in the last 90 days',
    severity: 'low',
    area: 'tools',
    rationale: 'Self-declarations are only useful while they’re current.',
    fixHref: '/tools',
    frameworks: [],
    evaluate: (s) => {
      const { members, confirmedWithin90Days } = s.declarations;
      if (members === 0) return notApplicable('no members to ask');
      return confirmedWithin90Days * 10 >= members * 8
        ? pass()
        : fail([orgSubject(s)], `${String(confirmedWithin90Days)} of ${String(members)} members confirmed`);
    },
  },
  {
    id: 'telemetry.coverage',
    title: 'Developers with coding seats report terminal-tool telemetry',
    severity: 'low',
    area: 'tools',
    rationale: 'Telemetry shows what coding tools cost per developer, even on subscriptions.',
    fixHref: '/my-tools',
    frameworks: [],
    evaluate: (s) => {
      const { codingSeatHolders, reporting } = s.telemetry;
      if (codingSeatHolders === 0) return notApplicable('no coding seats');
      return reporting * 10 >= codingSeatHolders * 8
        ? pass()
        : fail([orgSubject(s)], `${String(reporting)} of ${String(codingSeatHolders)} report telemetry`);
    },
  },
  {
    id: 'seats.extra_usage_alert',
    title: 'Overage charges on seats have an alert threshold',
    severity: 'low',
    area: 'seats',
    rationale: 'Usage-based extras on top of seats can’t be capped by Aperture; at least alert on them.',
    fixHref: '/seats',
    frameworks: [],
    evaluate: (s) => {
      const withExtra = s.seats.filter((seat) => usd(seat.extraUsage30d) > 0n);
      if (withExtra.length === 0) return notApplicable('no overage charges reported');
      return s.settings.extraUsageAlertConfigured
        ? pass()
        : fail(
            withExtra.map((seat) => ({ kind: 'seat' as const, id: seat.id, label: seat.toolId })),
            'no overage alert threshold set',
          );
    },
  },
];

export function postureCheck(id: string): PostureCheck | undefined {
  return POSTURE_CATALOGUE.find((check) => check.id === id);
}
