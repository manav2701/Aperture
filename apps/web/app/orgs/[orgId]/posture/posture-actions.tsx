'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function RunNow({ orgId }: { orgId: string }) {
  const { submit, pending, error } = useSubmit();
  return (
    <div className="space-y-1 text-right">
      <Button
        disabled={pending}
        onClick={() => {
          submit(() => api.POST('/api/v1/orgs/{orgId}/posture/runs', { params: { path: { orgId } } }));
        }}
      >
        {pending ? 'Running…' : 'Run checks now'}
      </Button>
      <FormError message={error} />
    </div>
  );
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export function WaiveCheck({
  orgId,
  checkId,
  subjects,
}: {
  orgId: string;
  checkId: string;
  subjects: { id: string; label: string }[];
}) {
  const { submit, pending, error } = useSubmit();
  const [subjectId, setSubjectId] = useState('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(inDays(30));
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Accept this risk (waive)</summary>
      <form
        className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_10rem_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          submit(() =>
            api.POST('/api/v1/orgs/{orgId}/posture/waivers', {
              params: { path: { orgId } },
              body: {
                checkId,
                subjectId: subjectId === '' ? null : subjectId,
                reason,
                expiresAt: new Date(`${until}T23:59:00`).toISOString(),
              },
            }),
          );
        }}
      >
        <Field label="Applies to" htmlFor={`w-subject-${checkId}`}>
          <Select id={`w-subject-${checkId}`} value={subjectId} onChange={(e) => { setSubjectId(e.target.value); }}>
            <option value="">The whole check</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reason (recorded in the audit log)" htmlFor={`w-reason-${checkId}`}>
          <Input id={`w-reason-${checkId}`} value={reason} required minLength={3} maxLength={1000} onChange={(e) => { setReason(e.target.value); }} />
        </Field>
        <Field label="Until (max 180 days)" htmlFor={`w-until-${checkId}`}>
          <Input id={`w-until-${checkId}`} type="date" value={until} min={inDays(1)} max={inDays(179)} onChange={(e) => { setUntil(e.target.value); }} />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          Waive
        </Button>
        <div className="md:col-span-4">
          <FormError message={error} />
        </div>
      </form>
    </details>
  );
}

export function RevokeWaiver({ orgId, waiverId }: { orgId: string; waiverId: string }) {
  const { submit, pending } = useSubmit();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        submit(() => api.DELETE('/api/v1/orgs/{orgId}/posture/waivers/{waiverId}', { params: { path: { orgId, waiverId } } }));
      }}
    >
      Revoke
    </Button>
  );
}
