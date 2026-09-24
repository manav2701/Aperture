'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormError, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';
import { RULE_EXAMPLES, STARTER_POLICY } from './rule-examples';

export function PolicyEditor({
  orgId,
  scope,
  scopeId,
  version,
  document,
  canEdit,
}: {
  orgId: string;
  scope: 'org' | 'team' | 'principal';
  scopeId: string;
  version: number;
  document: unknown;
  canEdit: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(document, null, 2));
  const { submit, pending, error, setError } = useSubmit();

  const publish = (event: SubmitEvent) => {
    event.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('The policy is not valid JSON.');
      return;
    }
    submit(() =>
      api.PUT('/api/v1/orgs/{orgId}/policies/{scope}/{scopeId}', {
        params: { path: { orgId, scope, scopeId } },
        // Publishing on top of a version someone else replaced fails instead of overwriting it.
        body: { document: parsed, expectedVersion: version },
      }),
    );
  };

  return (
    <form onSubmit={publish} className="space-y-3">
      <Textarea
        aria-label="Policy document"
        rows={14}
        spellCheck={false}
        readOnly={!canEdit}
        value={text}
        placeholder={STARTER_POLICY}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <FormError message={error} />
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            Publish version {version + 1}
          </Button>
        </div>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Rule types</summary>
        <ul className="mt-3 space-y-2">
          {Object.entries(RULE_EXAMPLES).map(([type, example]) => (
            <li key={type}>
              <code className="block overflow-x-auto bg-muted px-2 py-1 font-mono text-xs">
                {JSON.stringify(example)}
              </code>
            </li>
          ))}
        </ul>
      </details>
    </form>
  );
}
