import { formatUsd, micros } from '../money';
import { policyDocumentSchema, type PolicyDocumentInput } from './schema';

/*
 * Policy suggestions (plan/phases/phase-07 §7.6): when people keep approving the same kind of
 * request and never deny it, the threshold that sends it to them is probably too low. We group
 * approvals by the rule that asked for them and propose raising that rule's threshold just
 * above the largest amount approved. Suggestions never apply themselves.
 */

export interface ApprovalHistoryItem {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'used';
  amount: bigint;
  approvedAmount: bigint | null;
  /** The decision reasons stored with the approval (only `approval_required` ones matter). */
  reasons: readonly { code?: unknown; ruleId?: unknown; level?: unknown; scopeId?: unknown }[];
}

export interface EditablePolicy {
  level: 'org' | 'team' | 'principal';
  scopeId: string;
  version: number;
  document: unknown;
}

export interface ThresholdSuggestion {
  level: EditablePolicy['level'];
  scopeId: string;
  ruleId: string;
  currentAbove: string;
  suggestedAbove: string;
  approvals: number;
  /** The policy with only this rule changed, and the version it replaces (for a safe PUT). */
  document: { rules: Record<string, unknown>[] };
  expectedVersion: number;
}

export const SUGGESTION_MIN_APPROVALS = 3;

/** 10% headroom over the largest approval, rounded up to whole cents. */
function suggestedLimit(largest: bigint): bigint {
  const padded = (largest * 110n + 99n) / 100n;
  const cent = 10_000n;
  return ((padded + cent - 1n) / cent) * cent;
}

export function suggestThresholds(
  history: readonly ApprovalHistoryItem[],
  policies: readonly EditablePolicy[],
  minApprovals = SUGGESTION_MIN_APPROVALS,
): ThresholdSuggestion[] {
  const groups = new Map<string, { approved: number; denied: number; largest: bigint }>();
  for (const item of history) {
    if (item.status === 'pending' || item.status === 'expired') continue;
    for (const reason of item.reasons) {
      if (reason.code !== 'approval_required' || typeof reason.ruleId !== 'string') continue;
      if (typeof reason.level !== 'string' || typeof reason.scopeId !== 'string') continue;
      const key = `${reason.level}|${reason.scopeId}|${reason.ruleId}`;
      const group = groups.get(key) ?? { approved: 0, denied: 0, largest: 0n };
      if (item.status === 'denied') group.denied += 1;
      else {
        group.approved += 1;
        const amount = item.approvedAmount ?? item.amount;
        if (amount > group.largest) group.largest = amount;
      }
      groups.set(key, group);
    }
  }

  const suggestions: ThresholdSuggestion[] = [];
  for (const [key, group] of groups) {
    if (group.denied > 0 || group.approved < minApprovals) continue;
    const [level, scopeId, ruleId] = key.split('|') as [string, string, string];
    const policy = policies.find((p) => p.level === level && p.scopeId === scopeId);
    if (policy === undefined) continue;
    const parsed = policyDocumentSchema.safeParse(policy.document);
    if (!parsed.success) continue;
    const rule = parsed.data.rules.find((r) => r.id === ruleId);
    if (rule?.type !== 'approval_threshold') continue;
    const current = rule.above;
    const next = suggestedLimit(group.largest);
    if (next <= current) continue;
    const input = policy.document as PolicyDocumentInput;
    suggestions.push({
      level: policy.level,
      scopeId,
      ruleId,
      currentAbove: formatUsd(current),
      suggestedAbove: formatUsd(micros(next)),
      approvals: group.approved,
      document: {
        ...input,
        rules: input.rules.map((r) => (r.id === ruleId ? { ...r, above: formatUsd(micros(next)) } : r)),
      },
      expectedVersion: policy.version,
    });
  }
  return suggestions.sort((a, b) => b.approvals - a.approvals);
}
