'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Team } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

type Period = 'hour' | 'day' | 'week' | 'month' | 'none';

export function NewAgent({ orgId, teams }: { orgId: string; teams: Team[] }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState('');
  const [limit, setLimit] = useState('');
  const [period, setPeriod] = useState<Period>('day');
  const { submit, pending, error } = useSubmit();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submit(
      () =>
        api.POST('/api/v1/orgs/{orgId}/agents', {
          params: { path: { orgId } },
          body: {
            name,
            ...(description === '' ? {} : { description }),
            teamId: teamId === '' ? null : teamId,
            ...(limit === '' ? {} : { budget: { limit, period, mode: 'hard' as const } }),
          },
        }),
      () => {
        setName('');
        setDescription('');
        setLimit('');
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Name" htmlFor="agent-name">
        <Input
          id="agent-name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="What it does" htmlFor="agent-description">
        <Textarea
          id="agent-description"
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
      </Field>
      <Field label="Team" htmlFor="agent-team">
        <Select
          id="agent-team"
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
          }}
        >
          <option value="">No team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget (USD)" htmlFor="agent-limit" hint="Empty: shares its team’s or the org’s budget.">
          <Input
            id="agent-limit"
            inputMode="decimal"
            placeholder="5.00"
            pattern="\d+(\.\d{1,6})?"
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
            }}
          />
        </Field>
        <Field label="Per" htmlFor="agent-period">
          <Select
            id="agent-period"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as Period);
            }}
          >
            <option value="hour">hour</option>
            <option value="day">day</option>
            <option value="week">week</option>
            <option value="month">month</option>
            <option value="none">in total</option>
          </Select>
        </Field>
      </div>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Create agent
      </Button>
    </form>
  );
}
