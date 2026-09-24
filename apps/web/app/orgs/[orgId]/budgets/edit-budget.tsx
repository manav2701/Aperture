'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Budget } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

export function EditBudget({ orgId, budget }: { orgId: string; budget: Budget }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(budget.limit);
  const { submit, pending, error } = useSubmit();
  const path = { params: { path: { orgId, budgetId: budget.id } } };

  const save = (event: SubmitEvent) => {
    event.preventDefault();
    submit(
      () => api.PATCH('/api/v1/orgs/{orgId}/budgets/{budgetId}', { ...path, body: { limit } }),
      () => {
        setOpen(false);
      },
    );
  };

  const archive = () => {
    submit(() => api.PATCH('/api/v1/orgs/{orgId}/budgets/{budgetId}', { ...path, body: { archived: true } }));
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Edit
      </Button>
    );
  }

  return (
    <form onSubmit={save} className="flex w-full flex-wrap items-end gap-3 border-t border-border pt-3">
      <Field label={budget.unit === 'count' ? 'Limit (actions)' : 'Limit (USD)'} htmlFor={`limit-${budget.id}`}>
        <Input
          id={`limit-${budget.id}`}
          className="w-40"
          inputMode="decimal"
          required
          value={limit}
          onChange={(e) => {
            setLimit(e.target.value);
          }}
        />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button variant="danger" size="sm" disabled={pending} onClick={archive}>
        Archive
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(false);
        }}
      >
        Cancel
      </Button>
      <div className="w-full">
        <FormError message={error} />
      </div>
    </form>
  );
}
