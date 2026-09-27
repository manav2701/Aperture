'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { FormError, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Mandate } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

type Period = 'hour' | 'day' | 'week' | 'month' | 'none';

/** One agent's mandates as a delegation tree (its own → its sub-agents'), with revoke. */
export function MandateTree({ orgId, mandates, manage }: { orgId: string; mandates: Mandate[]; manage: boolean }) {
  const { submit, pending, error } = useSubmit();
  const ids = new Set(mandates.map((m) => m.id));
  const roots = mandates.filter((m) => m.parentId === null || !ids.has(m.parentId));
  const children = (id: string) => mandates.filter((m) => m.parentId === id);

  const node = (mandate: Mandate, depth: number) => (
    <li key={mandate.id} className="space-y-1" style={{ marginLeft: `${String(depth * 1.25)}rem` }}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {depth > 0 ? <span className="text-muted-foreground">↳ {mandate.subject.name}</span> : null}
        <span>{mandate.purpose}</span>
        <Badge>{mandate.remaining === null ? 'no cap' : `$${mandate.remaining} left`}</Badge>
        <Badge>
          {mandate.uses}
          {mandate.maxUses === null ? '' : `/${String(mandate.maxUses)}`} uses
        </Badge>
        {mandate.approvalId === null ? null : <Badge tone="accent">one-shot approval</Badge>}
        {manage ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              submit(() =>
                api.POST('/api/v1/orgs/{orgId}/mandates/{mandateId}/revoke', {
                  params: { path: { orgId, mandateId: mandate.id } },
                }),
              );
            }}
          >
            Revoke{children(mandate.id).length > 0 ? ' (and sub-agents)' : ''}
          </Button>
        ) : null}
      </div>
      <ul className="space-y-1">{children(mandate.id).map((child) => node(child, depth + 1))}</ul>
    </li>
  );

  if (mandates.length === 0) return null;
  return (
    <div className="space-y-1 border-t border-border pt-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Mandates</p>
      <ul className="space-y-1">{roots.map((root) => node(root, 0))}</ul>
      <FormError message={error} />
    </div>
  );
}

export function IssueMandate({ orgId, agentId }: { orgId: string; agentId: string }) {
  const { submit, pending, error } = useSubmit();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [limit, setLimit] = useState('');
  const [period, setPeriod] = useState<Period>('day');
  const [models, setModels] = useState('');

  if (!open) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Issue mandate
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const patterns = models
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m !== '');
        submit(
          () =>
            api.POST('/api/v1/orgs/{orgId}/agents/{principalId}/mandates', {
              params: { path: { orgId, principalId: agentId } },
              body: {
                purpose,
                budget: { limit, period },
                ...(patterns.length === 0 ? {} : { models: patterns }),
                validDays: 30,
              },
            }),
          () => {
            setOpen(false);
            setPurpose('');
            setLimit('');
            setModels('');
          },
        );
      }}
    >
      <Input
        aria-label="Purpose"
        placeholder="Purpose"
        className="h-8 w-48 text-sm"
        required
        value={purpose}
        onChange={(e) => {
          setPurpose(e.target.value);
        }}
      />
      <Input
        aria-label="Budget (USD)"
        placeholder="USD"
        className="h-8 w-20 text-sm"
        required
        inputMode="decimal"
        pattern="\d+(\.\d{1,6})?"
        value={limit}
        onChange={(e) => {
          setLimit(e.target.value);
        }}
      />
      <Select
        aria-label="Per"
        className="h-8 w-28 text-sm"
        value={period}
        onChange={(e) => {
          setPeriod(e.target.value as Period);
        }}
      >
        <option value="hour">per hour</option>
        <option value="day">per day</option>
        <option value="week">per week</option>
        <option value="month">per month</option>
        <option value="none">in total</option>
      </Select>
      <Input
        aria-label="Models"
        placeholder="Models, e.g. openai/*, anthropic/* (optional)"
        className="h-8 w-64 text-sm"
        value={models}
        onChange={(e) => {
          setModels(e.target.value);
        }}
      />
      <Button type="submit" size="sm" disabled={pending}>
        Issue (valid 30 days)
      </Button>
      <FormError message={error} />
    </form>
  );
}
