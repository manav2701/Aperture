import { describe, expect, it } from 'vitest';
import { parseUsd } from '../money';
import { suggestThresholds, type ApprovalHistoryItem } from './suggest';

const policy = {
  level: 'org' as const,
  scopeId: 'org-1',
  version: 4,
  document: {
    rules: [
      { id: 'ask', type: 'approval_threshold', above: '1' },
      { id: 'no-gpt5', type: 'deny_models', patterns: ['openai/gpt-5*'] },
    ],
  },
};
const asked = [{ code: 'approval_required', ruleId: 'ask', level: 'org', scopeId: 'org-1' }];
const item = (status: ApprovalHistoryItem['status'], amount: string, approved?: string): ApprovalHistoryItem => ({
  status,
  amount: parseUsd(amount),
  approvedAmount: approved === undefined ? null : parseUsd(approved),
  reasons: asked,
});

describe('policy suggestions', () => {
  it('proposes raising a threshold people keep approving, changing only that rule', () => {
    const [suggestion, ...rest] = suggestThresholds(
      [item('used', '1.5'), item('approved', '2', '1.8'), item('used', '1.2'), item('pending', '9')],
      [policy],
    );
    expect(rest).toEqual([]);
    expect(suggestion).toMatchObject({
      ruleId: 'ask',
      currentAbove: '1.00',
      suggestedAbove: '1.98',
      approvals: 3,
      expectedVersion: 4,
    });
    expect(suggestion?.document.rules).toEqual([
      { id: 'ask', type: 'approval_threshold', above: '1.98' },
      { id: 'no-gpt5', type: 'deny_models', patterns: ['openai/gpt-5*'] },
    ]);
  });

  it('stays quiet after any denial, below the minimum, or when the rule is gone', () => {
    expect(
      suggestThresholds([item('used', '2'), item('used', '2'), item('denied', '2'), item('used', '2')], [policy]),
    ).toEqual([]);
    expect(suggestThresholds([item('used', '2'), item('used', '2')], [policy])).toEqual([]);
    expect(
      suggestThresholds(
        [item('used', '2'), item('used', '2'), item('used', '2')],
        [{ ...policy, document: { rules: [] } }],
      ),
    ).toEqual([]);
  });
});
