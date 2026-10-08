import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coverageShares, formatShare } from '../coverage';
import { POSTURE_CATALOGUE, postureCheck } from './catalogue';
import { evaluatePosture, gradeFor, newFailures, resultsForTeam } from './evaluate';
import type { PostureSnapshot, SnapshotAgent, SnapshotPolicy } from './types';

/** The first element; the fixtures always have one. */
function at0<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('fixture is empty');
  return item;
}

const NOW = new Date('2026-10-08T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const ORG = '00000000-0000-4000-8000-000000000001';
const TEAM = '00000000-0000-4000-8000-0000000000aa';

const agent = (over: Partial<SnapshotAgent> = {}): SnapshotAgent => ({
  id: 'agent-1',
  name: 'Research bot',
  status: 'active',
  teamId: TEAM,
  ownerUserId: 'user-owner-1',
  ownerIsMember: true,
  riskTier: null,
  lastActivityAt: daysAgo(1),
  liveKeys: 1,
  activeCards: 0,
  activeX402: 0,
  hardBudgetOnPath: true,
  isSystem: false,
  createdAt: daysAgo(10),
  ...over,
});

const orgPolicy = (over: Partial<SnapshotPolicy> = {}): SnapshotPolicy => ({
  scope: 'org',
  scopeId: ORG,
  ruleTypes: ['allow_models', 'max_amount_per_action', 'approval_threshold', 'merchant_categories', 'x402_payees'],
  approvalRails: [null],
  perActionRails: [null],
  perActionCaps: [{ rail: null, max: '50000000' }],
  promptLogging: null,
  ...over,
});

/** An org where every check passes or doesn't apply. */
function healthy(): PostureSnapshot {
  return {
    orgId: ORG,
    takenAt: NOW.toISOString(),
    rails: { gateway: true, provider: true, card: true, x402: true },
    budgets: [{ id: 'b-org', scope: 'org', scopeId: ORG, mode: 'hard', unit: 'micros', alertThresholds: [80, 100] }],
    policies: [orgPolicy()],
    agents: [agent()],
    members: [
      { userId: 'user-owner-1', role: 'owner', twoFactor: true },
      { userId: 'user-owner-2', role: 'owner', twoFactor: true },
      { userId: 'user-member', role: 'member', twoFactor: false },
    ],
    apiKeys: [
      {
        id: 'k1',
        principalId: 'agent-1',
        name: 'prod',
        expiresAt: daysAgo(-30),
        lastUsedAt: daysAgo(1),
        createdAt: daysAgo(10),
      },
    ],
    connections: [
      {
        id: 'c1',
        provider: 'openrouter',
        name: 'OpenRouter',
        status: 'active',
        lastError: null,
        lastSyncedAt: daysAgo(0.1),
        syncs: true,
      },
    ],
    credentials: [
      {
        id: 'cr1',
        connectionId: 'c1',
        provider: 'openrouter',
        name: 'k',
        principalId: 'agent-1',
        createdByAperture: true,
        usage30d: '5000000',
        revocable: true,
      },
    ],
    unassignedUsage: [],
    cards: [
      {
        id: 'card1',
        principalId: 'agent-1',
        kind: 'agent',
        status: 'active',
        expiresAt: null,
        hasCategoryControls: true,
      },
    ],
    unseenCardAuthorizations: 0,
    x402Accounts: [
      {
        id: 'x1',
        principalId: 'agent-1',
        status: 'active',
        allowance: '10000000',
        maxPerPayment: '1000000',
        remainingBudget: '20000000',
      },
    ],
    mandates: [
      {
        id: 'm1',
        subjectPrincipalId: 'agent-1',
        subjectStatus: 'active',
        notBefore: daysAgo(1),
        expiresAt: daysAgo(-29),
      },
    ],
    signingKeyCreatedAt: daysAgo(30),
    audit: { chainIntact: true, brokenAtSeq: null, anchoringEnabled: true, lastAnchorAt: daysAgo(0.5) },
    settings: { requestLogDays: 90, idleSeatDays: 30, extraUsageAlertConfigured: true },
    ledgerDrift: false,
    seats: [
      {
        id: 's1',
        toolId: 'cursor',
        userId: 'user-member',
        status: 'active',
        payer: 'company',
        source: 'connector',
        lastActiveAt: daysAgo(2),
        extraUsage30d: '0',
      },
    ],
    approvedTools: ['cursor', 'claude'],
    toolsInUse: [{ toolId: 'cursor', userId: 'user-member', source: 'connector' }],
    declarations: { members: 3, confirmedWithin90Days: 3 },
    telemetry: { codingSeatHolders: 1, reporting: 1 },
  };
}

const statusOf = (snapshot: PostureSnapshot, id: string) => {
  const check = postureCheck(id);
  if (check === undefined) throw new Error(`no check ${id}`);
  return check.evaluate(snapshot, NOW).status;
};

/** One way to break each check, starting from the healthy org. */
const BREAKERS: Record<string, (s: PostureSnapshot) => void> = {
  'spend.org_root_hard': (s) => (s.budgets = []),
  'spend.agent_capped': (s) => (s.agents = [agent({ hardBudgetOnPath: false })]),
  'spend.soft_without_alerts': (s) =>
    s.budgets.push({ id: 'b-soft', scope: 'team', scopeId: TEAM, mode: 'soft', unit: 'micros', alertThresholds: [] }),
  'spend.approval_threshold_card_x402': (s) => (s.policies = [orgPolicy({ approvalRails: ['gateway'] })]),
  'spend.per_action_cap_agents': (s) =>
    (s.policies = [
      orgPolicy({ ruleTypes: ['allow_models', 'approval_threshold', 'merchant_categories', 'x402_payees'] }),
    ]),
  'spend.model_allowlist': (s) =>
    (s.policies = [
      orgPolicy({ ruleTypes: ['max_amount_per_action', 'approval_threshold', 'merchant_categories', 'x402_payees'] }),
    ]),
  'access.privileged_2fa': (s) => s.members.push({ userId: 'fin', role: 'finance', twoFactor: false }),
  'access.owner_count': (s) => (s.members = s.members.filter((m) => m.userId !== 'user-owner-2')),
  'access.agent_has_owner': (s) => (s.agents = [agent({ ownerIsMember: false })]),
  'keys.expiry_set': (s) => (s.apiKeys = [{ ...at0(s.apiKeys), expiresAt: null }]),
  'keys.idle_live': (s) => (s.apiKeys = [{ ...at0(s.apiKeys), lastUsedAt: daysAgo(31) }]),
  'keys.age': (s) => (s.apiKeys = [{ ...at0(s.apiKeys), createdAt: daysAgo(91) }]),
  'agents.idle_with_credentials': (s) => (s.agents = [agent({ lastActivityAt: daysAgo(45) })]),
  'agents.high_risk_hard_capped': (s) => {
    s.agents = [agent({ riskTier: 'high' })];
    s.policies = [
      orgPolicy({
        ruleTypes: ['allow_models', 'max_amount_per_action', 'merchant_categories', 'x402_payees'],
        approvalRails: [],
      }),
    ];
    s.rails.card = false;
    s.rails.x402 = false;
  },
  'conn.healthy': (s) => (s.connections = [{ ...at0(s.connections), lastSyncedAt: daysAgo(2) }]),
  'conn.unassigned_usage': (s) => (s.unassignedUsage = [{ credentialId: 'cr9', name: 'stray key', amount: '1200000' }]),
  'conn.enforceable': (s) => (s.credentials = [{ ...at0(s.credentials), createdByAperture: false, revocable: false }]),
  'cards.merchant_rule': (s) => {
    s.cards = [{ ...at0(s.cards), hasCategoryControls: false }];
    s.policies = [
      orgPolicy({ ruleTypes: ['allow_models', 'max_amount_per_action', 'approval_threshold', 'x402_payees'] }),
    ];
  },
  'cards.task_expired_active': (s) =>
    s.cards.push({
      id: 'card2',
      principalId: 'agent-1',
      kind: 'task',
      status: 'active',
      expiresAt: daysAgo(1),
      hasCategoryControls: true,
    }),
  'cards.unseen_auths': (s) => (s.unseenCardAuthorizations = 2),
  'x402.allowance_within_budget': (s) => (s.x402Accounts = [{ ...at0(s.x402Accounts), remainingBudget: '5000000' }]),
  'x402.per_payment_cap': (s) => (s.x402Accounts = [{ ...at0(s.x402Accounts), maxPerPayment: '60000000' }]),
  'x402.payee_allowlist': (s) =>
    (s.policies = [
      orgPolicy({ ruleTypes: ['allow_models', 'max_amount_per_action', 'approval_threshold', 'merchant_categories'] }),
    ]),
  'mandates.bounded_expiry': (s) => (s.mandates = [{ ...at0(s.mandates), expiresAt: daysAgo(-120) }]),
  'mandates.orphaned': (s) => (s.mandates = [{ ...at0(s.mandates), subjectStatus: 'paused' }]),
  'mandates.key_rotation': (s) => (s.signingKeyCreatedAt = daysAgo(400)),
  'audit.chain_intact': (s) => (s.audit = { ...s.audit, chainIntact: false, brokenAtSeq: 17 }),
  'audit.anchored': (s) => (s.audit = { ...s.audit, lastAnchorAt: daysAgo(3) }),
  'data.prompt_logging_full': (s) => (s.policies = [orgPolicy({ promptLogging: 'full' })]),
  'data.retention': (s) => (s.settings = { ...s.settings, requestLogDays: 400 }),
  'ledger.no_drift': (s) => (s.ledgerDrift = true),
  'seats.idle': (s) => (s.seats = [{ ...at0(s.seats), lastActiveAt: daysAgo(40) }]),
  'seats.personal_duplicates': (s) =>
    s.seats.push({
      id: 's2',
      toolId: 'cursor',
      userId: 'user-member',
      status: 'active',
      payer: 'personal_expensed',
      source: 'receipt',
      lastActiveAt: null,
      extraUsage30d: '0',
    }),
  'tools.unapproved': (s) => s.toolsInUse.push({ toolId: 'midjourney', userId: 'user-member', source: 'declared' }),
  'tools.declaration_fresh': (s) => (s.declarations = { members: 10, confirmedWithin90Days: 7 }),
  'telemetry.coverage': (s) => (s.telemetry = { codingSeatHolders: 5, reporting: 3 }),
  'seats.extra_usage_alert': (s) => {
    s.seats = [{ ...at0(s.seats), extraUsage30d: '12000000' }];
    s.settings = { ...s.settings, extraUsageAlertConfigured: false };
  },
};

describe('posture catalogue v1', () => {
  it('has unique ids and a breaker test for every check', () => {
    const ids = POSTURE_CATALOGUE.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(BREAKERS).sort()).toEqual([...ids].sort());
  });

  it('passes every applicable check on a healthy org', () => {
    const result = evaluatePosture(healthy(), { now: NOW });
    const notPassing = result.results
      .filter((r) => r.status !== 'pass' && r.status !== 'not_applicable')
      .map((r) => `${r.id}: ${r.status} ${r.detail ?? ''}`);
    expect(notPassing).toEqual([]);
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
  });

  it.each(Object.entries(BREAKERS))('%s fails when broken', (id, breaker) => {
    const snapshot = healthy();
    breaker(snapshot);
    expect(statusOf(snapshot, id)).toBe('fail');
  });

  it('answers "not applicable" for rails an org has not set up, and leaves them out of the score', () => {
    const snapshot = healthy();
    snapshot.rails = { gateway: false, provider: false, card: false, x402: false };
    snapshot.cards = [];
    snapshot.x402Accounts = [];
    expect(statusOf(snapshot, 'cards.unseen_auths')).toBe('not_applicable');
    expect(statusOf(snapshot, 'spend.approval_threshold_card_x402')).toBe('not_applicable');
    expect(statusOf(snapshot, 'x402.payee_allowlist')).toBe('not_applicable');
    expect(evaluatePosture(snapshot, { now: NOW }).score).toBe(100);
  });

  it('counts "unknown" as a failure in the score', () => {
    const snapshot = healthy();
    snapshot.audit = { ...snapshot.audit, chainIntact: null };
    const result = evaluatePosture(snapshot, { now: NOW });
    expect(result.results.find((r) => r.id === 'audit.chain_intact')?.status).toBe('unknown');
    expect(result.score).toBeLessThan(100);
  });
});

describe('waivers', () => {
  it('excuse one subject, keep it listed, and count the check as passed once nothing else fails', () => {
    const snapshot = healthy();
    snapshot.apiKeys = [{ ...at0(snapshot.apiKeys), expiresAt: null }];
    const waived = evaluatePosture(snapshot, {
      now: NOW,
      waivers: [{ checkId: 'keys.expiry_set', subjectId: 'k1', expiresAt: daysAgo(-10) }],
    });
    const result = waived.results.find((r) => r.id === 'keys.expiry_set');
    expect(result?.status).toBe('waived');
    expect(result?.waivedSubjects.map((s) => s.id)).toEqual(['k1']);
    expect(waived.score).toBe(100);
  });

  it('stop applying when they expire', () => {
    const snapshot = healthy();
    snapshot.apiKeys = [{ ...at0(snapshot.apiKeys), expiresAt: null }];
    const result = evaluatePosture(snapshot, {
      now: NOW,
      waivers: [{ checkId: 'keys.expiry_set', subjectId: null, expiresAt: daysAgo(1) }],
    });
    expect(result.results.find((r) => r.id === 'keys.expiry_set')?.status).toBe('fail');
  });

  it('change only their own check', () => {
    const snapshot = healthy();
    BREAKERS['keys.expiry_set']?.(snapshot);
    BREAKERS['keys.age']?.(snapshot);
    const result = evaluatePosture(snapshot, {
      now: NOW,
      waivers: [{ checkId: 'keys.expiry_set', subjectId: null, expiresAt: daysAgo(-10) }],
    });
    expect(result.results.find((r) => r.id === 'keys.age')?.status).toBe('fail');
  });
});

describe('scoring', () => {
  it('maps scores to grades', () => {
    expect([100, 90, 89, 75, 60, 40, 39, 0].map(gradeFor)).toEqual(['A', 'A', 'B', 'B', 'C', 'D', 'F', 'F']);
  });

  it('weights a critical failure more than a low one', () => {
    const critical = healthy();
    BREAKERS['ledger.no_drift']?.(critical);
    const low = healthy();
    BREAKERS['data.retention']?.(low);
    expect(evaluatePosture(critical, { now: NOW }).score).toBeLessThan(evaluatePosture(low, { now: NOW }).score);
  });

  it('reports only failures that are new since the previous run', () => {
    const before = healthy();
    BREAKERS['keys.age']?.(before);
    const previous = evaluatePosture(before, { now: NOW }).results;
    const after = healthy();
    BREAKERS['keys.age']?.(after);
    BREAKERS['cards.unseen_auths']?.(after);
    expect(newFailures(previous, evaluatePosture(after, { now: NOW }).results).map((r) => r.id)).toEqual([
      'cards.unseen_auths',
    ]);
  });

  it('filters subjects to a team for team leads', () => {
    const snapshot = healthy();
    snapshot.agents = [
      agent({ hardBudgetOnPath: false }),
      agent({ id: 'agent-2', teamId: 'other', hardBudgetOnPath: false }),
    ];
    const results = resultsForTeam(evaluatePosture(snapshot, { now: NOW }).results, TEAM);
    expect(results.find((r) => r.id === 'spend.agent_capped')?.subjects.map((s) => s.id)).toEqual(['agent-1']);
  });
});

/** Snapshots built from the breakers: any subset of problems applied to the healthy org. */
const brokenSnapshot = fc.subarray(Object.keys(BREAKERS), { minLength: 0 }).map((ids) => {
  const snapshot = healthy();
  for (const id of ids) BREAKERS[id]?.(snapshot);
  return snapshot;
});

/** Controls an admin can add; none may ever lower the score (monotonicity, plan §11 tests). */
const CONTROLS: ((s: PostureSnapshot) => void)[] = [
  (s) =>
    s.budgets.push({ id: 'b-root', scope: 'org', scopeId: ORG, mode: 'hard', unit: 'micros', alertThresholds: [80] }),
  (s) => (s.members = s.members.map((m) => ({ ...m, twoFactor: true }))),
  (s) => (s.apiKeys = s.apiKeys.map((k) => ({ ...k, expiresAt: k.expiresAt ?? daysAgo(-30) }))),
  (s) => (s.agents = s.agents.map((a) => ({ ...a, hardBudgetOnPath: true }))),
  (s) => s.policies.push(orgPolicy({ promptLogging: null })),
];

describe('properties', () => {
  it('evaluatePosture is deterministic', () => {
    fc.assert(
      fc.property(brokenSnapshot, (snapshot) => {
        expect(evaluatePosture(snapshot, { now: NOW })).toEqual(
          evaluatePosture(structuredClone(snapshot), { now: NOW }),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('adding a control never lowers the score', () => {
    fc.assert(
      fc.property(brokenSnapshot, fc.integer({ min: 0, max: CONTROLS.length - 1 }), (snapshot, index) => {
        const before = evaluatePosture(snapshot, { now: NOW }).score;
        const improved = structuredClone(snapshot);
        CONTROLS[index]?.(improved);
        expect(evaluatePosture(improved, { now: NOW }).score).toBeGreaterThanOrEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it('coverage shares always sum to 100% (or 0 without spend)', () => {
    const amount = fc.bigInt({ min: -1_000_000n, max: 10n ** 15n });
    fc.assert(
      fc.property(amount, amount, amount, amount, (enforced, visible, unassigned, external) => {
        const shares = coverageShares({ enforced, visible, unassigned, external });
        const total = shares.reduce((sum, s) => sum + s.basisPoints, 0);
        const anySpend = [enforced, visible, unassigned, external].some((v) => v > 0n);
        expect(total).toBe(anySpend ? 10_000 : 0);
        for (const s of shares) expect(s.basisPoints).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });
});

describe('coverage', () => {
  it('rounds with the largest remainder and formats', () => {
    const shares = coverageShares({ enforced: 1n, visible: 1n, unassigned: 1n, external: 0n });
    expect(shares.map((s) => s.basisPoints)).toEqual([3334, 3333, 3333, 0]);
    expect(formatShare(8215)).toBe('82.15%');
    expect(formatShare(5)).toBe('0.05%');
  });
});
