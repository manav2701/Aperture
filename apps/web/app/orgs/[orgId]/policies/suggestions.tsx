'use client';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

interface Suggestion {
  level: 'org' | 'team' | 'principal';
  scopeId: string;
  ruleId: string;
  currentAbove: string;
  suggestedAbove: string;
  approvals: number;
  document: { rules: Record<string, unknown>[] };
  expectedVersion: number;
}

/** "People keep approving this" cards; applying publishes a new, audited policy version. */
export function PolicySuggestions({
  orgId,
  suggestions,
  scopeLabel,
}: {
  orgId: string;
  suggestions: Suggestion[];
  scopeLabel: Record<string, string>;
}) {
  const { submit, pending, error } = useSubmit();
  if (suggestions.length === 0) return null;
  return (
    <Card className="mb-8">
      <CardTitle>Suggestions</CardTitle>
      <ul className="divide-y divide-border">
        {suggestions.map((s) => (
          <li
            key={`${s.level}:${s.scopeId}:${s.ruleId}`}
            className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
          >
            <span>
              {s.approvals} requests over ${s.currentAbove} in {scopeLabel[`${s.level}:${s.scopeId}`] ?? s.level} were
              approved in the last 30 days and none denied. Raise rule <code className="font-mono">{s.ruleId}</code> to
              ask only above <strong>${s.suggestedAbove}</strong>?
            </span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                submit(() =>
                  api.PUT('/api/v1/orgs/{orgId}/policies/{scope}/{scopeId}', {
                    params: { path: { orgId, scope: s.level, scopeId: s.scopeId } },
                    body: { document: s.document, expectedVersion: s.expectedVersion },
                  }),
                );
              }}
            >
              Apply
            </Button>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </Card>
  );
}
