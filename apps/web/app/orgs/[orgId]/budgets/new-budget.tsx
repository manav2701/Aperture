'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Budget, Principal, Team } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

type Scope = 'org' | 'team' | 'principal';
type Period = 'hour' | 'day' | 'week' | 'month' | 'none';

export function NewBudget({
  orgId,
  budgets,
  teams,
  principals,
}: {
  orgId: string;
  budgets: Budget[];
  teams: Team[];
  principals: Principal[];
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [scope, setScope] = useState<Scope>('org');
  const [scopeId, setScopeId] = useState('');
  const [period, setPeriod] = useState<Period>('month');
  const [limit, setLimit] = useState('');
  const [mode, setMode] = useState<'hard' | 'soft'>('hard');
  const { submit, pending, error } = useSubmit();

  const targets =
    scope === 'team' ? teams : scope === 'principal' ? principals.filter((p) => p.status === 'active') : [];

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submit(
      () =>
        api.POST('/api/v1/orgs/{orgId}/budgets', {
          params: { path: { orgId } },
          body: {
            name,
            parentId: parentId === '' ? null : parentId,
            scope,
            scopeId: scope === 'org' ? null : scopeId,
            period,
            limit,
            mode,
          },
        }),
      () => {
        setName('');
        setLimit('');
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Name" htmlFor="budget-name">
        <Input
          id="budget-name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="Inside" htmlFor="budget-parent" hint="Spend here also counts against the budget it sits in.">
        <Select
          id="budget-parent"
          value={parentId}
          onChange={(e) => {
            setParentId(e.target.value);
          }}
        >
          <option value="">Nothing (top level)</option>
          {budgets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Applies to" htmlFor="budget-scope">
        <Select
          id="budget-scope"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as Scope);
            setScopeId('');
          }}
        >
          <option value="org">The whole organization</option>
          <option value="team">A team</option>
          <option value="principal">A person</option>
        </Select>
      </Field>
      {scope === 'org' ? null : (
        <Field label={scope === 'team' ? 'Team' : 'Person'} htmlFor="budget-target">
          <Select
            id="budget-target"
            required
            value={scopeId}
            onChange={(e) => {
              setScopeId(e.target.value);
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Resets every" htmlFor="budget-period">
          <Select
            id="budget-period"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as Period);
            }}
          >
            <option value="hour">hour</option>
            <option value="day">day</option>
            <option value="week">week</option>
            <option value="month">month</option>
            <option value="none">never</option>
          </Select>
        </Field>
        <Field label="Limit (USD)" htmlFor="budget-limit">
          <Input
            id="budget-limit"
            required
            inputMode="decimal"
            placeholder="250.00"
            pattern="\d+(\.\d{1,6})?"
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
            }}
          />
        </Field>
      </div>
      <Field label="When the limit is reached" htmlFor="budget-mode">
        <Select
          id="budget-mode"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as 'hard' | 'soft');
          }}
        >
          <option value="hard">Deny further spend (hard)</option>
          <option value="soft">Allow, but alert (soft)</option>
        </Select>
      </Field>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Create budget
      </Button>
    </form>
  );
}
