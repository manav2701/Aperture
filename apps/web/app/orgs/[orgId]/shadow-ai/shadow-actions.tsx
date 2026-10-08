'use client';

import { AI_TOOLS } from '@aperture/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

type Assignee = { id: string; name: string };

export function ClaimKey({ orgId, credentialId, assignees }: { orgId: string; credentialId: string; assignees: Assignee[] }) {
  const { submit, pending, error } = useSubmit();
  const [principalId, setPrincipalId] = useState(assignees[0]?.id ?? '');
  if (assignees.length === 0) return <span className="text-xs text-muted-foreground">Create an agent to claim it.</span>;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit(() =>
          api.PATCH('/api/v1/orgs/{orgId}/credentials/{credentialId}', {
            params: { path: { orgId, credentialId } },
            body: { principalId },
          }),
        );
      }}
    >
      <Select aria-label="Assign to" className="h-8 w-48 text-sm" value={principalId} onChange={(e) => { setPrincipalId(e.target.value); }}>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Claim
      </Button>
      <FormError message={error} />
    </form>
  );
}

export function ResolveCharge({
  orgId,
  rowId,
  assignees,
  teams,
}: {
  orgId: string;
  rowId: string;
  assignees: Assignee[];
  teams: { id: string; name: string }[];
}) {
  const { submit, pending, error } = useSubmit();
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const resolve = (action: 'assign' | 'govern' | 'dismiss') => {
    const [kind, id] = target.split(':');
    submit(() =>
      api.PATCH('/api/v1/orgs/{orgId}/external-spend/{rowId}', {
        params: { path: { orgId, rowId } },
        body: {
          action,
          ...(action === 'assign' ? (kind === 'team' ? { teamId: id ?? null } : { principalId: id ?? null }) : {}),
          ...(note === '' ? {} : { note }),
        },
      }),
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Assign to" className="h-8 w-48 text-sm" value={target} onChange={(e) => { setTarget(e.target.value); }}>
        <option value="">Assign to…</option>
        {assignees.map((a) => (
          <option key={a.id} value={`principal:${a.id}`}>
            {a.name}
          </option>
        ))}
        {teams.map((t) => (
          <option key={t.id} value={`team:${t.id}`}>
            Team: {t.name}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="secondary" disabled={pending || target === ''} onClick={() => { resolve('assign'); }}>
        Assign
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => { resolve('govern'); }} title="It now runs through Aperture (connected provider, agent card, or workspace)">
        Brought under governance
      </Button>
      <Input aria-label="Reason" placeholder="Reason to dismiss" className="h-8 w-48 text-sm" value={note} onChange={(e) => { setNote(e.target.value); }} />
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { resolve('dismiss'); }}>
        Dismiss
      </Button>
      <FormError message={error} />
    </div>
  );
}

export function ResolveReceipt({
  orgId,
  receiptId,
  defaults,
}: {
  orgId: string;
  receiptId: string;
  defaults: { toolId: string | null; amount: string | null; currency: string | null; occurredOn: string | null };
}) {
  const { submit, pending, error } = useSubmit();
  const [toolId, setToolId] = useState(defaults.toolId ?? '');
  const [amount, setAmount] = useState(defaults.amount ?? '');
  const [currency, setCurrency] = useState(defaults.currency ?? 'USD');
  const [date, setDate] = useState(defaults.occurredOn ?? new Date().toISOString().slice(0, 10));
  const [oneOff, setOneOff] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit(() =>
          api.POST('/api/v1/orgs/{orgId}/receipts/{receiptId}/resolve', {
            params: { path: { orgId, receiptId } },
            body: { action: 'import', toolId, amount, currency, occurredOn: date, oneOff },
          }),
        );
      }}
    >
      <Select aria-label="Tool" className="h-8 w-44 text-sm" value={toolId} onChange={(e) => { setToolId(e.target.value); }} required>
        <option value="">Tool…</option>
        {AI_TOOLS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.product}
          </option>
        ))}
      </Select>
      <Input aria-label="Amount" className="h-8 w-24 text-sm" value={amount} onChange={(e) => { setAmount(e.target.value); }} required pattern="\d+(\.\d{1,6})?" />
      <Input aria-label="Currency" className="h-8 w-16 text-sm" value={currency} maxLength={3} onChange={(e) => { setCurrency(e.target.value.toUpperCase()); }} />
      <Input aria-label="Date" type="date" className="h-8 w-40 text-sm" value={date} onChange={(e) => { setDate(e.target.value); }} />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={oneOff} onChange={(e) => { setOneOff(e.target.checked); }} /> one-off purchase
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Import
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          submit(() =>
            api.POST('/api/v1/orgs/{orgId}/receipts/{receiptId}/resolve', {
              params: { path: { orgId, receiptId } },
              body: { action: 'dismiss' },
            }),
          );
        }}
      >
        Dismiss
      </Button>
      <FormError message={error} />
    </form>
  );
}
