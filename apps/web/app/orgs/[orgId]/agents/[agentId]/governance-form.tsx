'use client';

import { DATA_CLASSES } from '@aperture/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

const LABEL: Record<(typeof DATA_CLASSES)[number], string> = {
  none: 'No sensitive data',
  internal: 'Internal',
  customer_personal: 'Customer personal data',
  financial: 'Financial',
  health: 'Health',
};

export function AgentGovernanceForm({
  orgId,
  agentId,
  declared,
  canSetRisk,
}: {
  orgId: string;
  agentId: string;
  declared: { purpose: string | null; dataClasses: string[]; riskTier: 'low' | 'medium' | 'high' | null };
  canSetRisk: boolean;
}) {
  const { submit, pending, error } = useSubmit();
  const [purpose, setPurpose] = useState(declared.purpose ?? '');
  const [classes, setClasses] = useState<string[]>(declared.dataClasses);
  const [risk, setRisk] = useState<string>(declared.riskTier ?? '');
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Edit what this agent declares</summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(() =>
            api.PATCH('/api/v1/orgs/{orgId}/agents/{principalId}/governance', {
              params: { path: { orgId, principalId: agentId } },
              body: {
                purpose: purpose.trim() === '' ? null : purpose.trim(),
                dataClasses: classes as (typeof DATA_CLASSES)[number][],
                ...(canSetRisk ? { riskTier: risk === '' ? null : (risk as 'low' | 'medium' | 'high') } : {}),
              },
            }),
          );
        }}
      >
        <Field label="Purpose" htmlFor="agent-purpose" hint="What it does and for whom (500 characters).">
          <Textarea id="agent-purpose" rows={3} maxLength={500} value={purpose} onChange={(e) => { setPurpose(e.target.value); }} />
        </Field>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Data it handles</legend>
          {DATA_CLASSES.map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={classes.includes(value)}
                onChange={(e) => {
                  setClasses(e.target.checked ? [...classes, value] : classes.filter((c) => c !== value));
                }}
              />
              {LABEL[value]}
            </label>
          ))}
        </fieldset>
        {canSetRisk ? (
          <Field label="Risk tier" htmlFor="agent-risk" hint="High-risk agents need a hard budget and an approval threshold (posture check).">
            <Select id="agent-risk" value={risk} onChange={(e) => { setRisk(e.target.value); }}>
              <option value="">Not set</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
        ) : null}
        <FormError message={error} />
        <Button type="submit" variant="secondary" disabled={pending}>
          Save
        </Button>
      </form>
    </details>
  );
}
