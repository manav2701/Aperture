'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function DecideApproval({ orgId, approvalId, amount }: { orgId: string; approvalId: string; amount: string }) {
  const { submit, pending, error } = useSubmit();
  const [cap, setCap] = useState(amount);
  const [note, setNote] = useState('');
  const path = { params: { path: { orgId, approvalId } } };
  const body = note === '' ? {} : { note };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Approve up to (USD)"
          className="h-8 w-28 text-sm"
          inputMode="decimal"
          pattern="\d+(\.\d{1,6})?"
          value={cap}
          onChange={(e) => {
            setCap(e.target.value);
          }}
        />
        <Input
          aria-label="Note"
          placeholder="Note (optional)"
          className="h-8 w-56 text-sm"
          maxLength={500}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            submit(() =>
              api.POST('/api/v1/orgs/{orgId}/approvals/{approvalId}/approve', {
                ...path,
                body: { ...body, ...(cap === amount || cap === '' ? {} : { amount: cap }) },
              }),
            );
          }}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => {
            submit(() => api.POST('/api/v1/orgs/{orgId}/approvals/{approvalId}/deny', { ...path, body }));
          }}
        >
          Deny
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
