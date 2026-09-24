'use client';

import type { Role } from '@aperture/core';
import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Team } from '@/lib/api/types';
import { roleLabel } from '@/lib/format';
import { useSubmit } from '@/lib/use-submit';
import { ROLE_DESCRIPTIONS, assignableRoles } from './roles';

export function InviteForm({ orgId, teams, actorRole }: { orgId: string; teams: Team[]; actorRole: Role }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [teamId, setTeamId] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { submit, pending, error } = useSubmit();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const invited = email;
    submit(
      () =>
        api.POST('/api/v1/orgs/{orgId}/invitations', {
          params: { path: { orgId } },
          body: { email, role, teamId: teamId === '' ? null : teamId },
        }),
      () => {
        setSentTo(invited);
        setEmail('');
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" htmlFor="invite-email">
        <Input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </Field>
      <Field label="Role" htmlFor="invite-role" hint={ROLE_DESCRIPTIONS[role]}>
        <Select
          id="invite-role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role);
          }}
        >
          {assignableRoles(actorRole).map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Team"
        htmlFor="invite-team"
        hint={role === 'team_lead' ? 'Team leads manage this team.' : undefined}
      >
        <Select
          id="invite-team"
          value={teamId}
          required={role === 'team_lead'}
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
      <FormError message={error} />
      {sentTo === null ? null : <FormNotice>Invitation sent to {sentTo}. It is valid for 7 days.</FormNotice>}
      <Button type="submit" className="w-full" disabled={pending}>
        Send invitation
      </Button>
    </form>
  );
}
