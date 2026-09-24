'use client';

import { canAssignRole, type Role } from '@aperture/core';
import { useState } from 'react';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormError, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Member, Team } from '@/lib/api/types';
import { roleLabel } from '@/lib/format';
import { useSubmit } from '@/lib/use-submit';
import { assignableRoles } from './roles';

export function MemberRow({
  orgId,
  member,
  teams,
  isSelf,
  actorRole,
  canManage,
}: {
  orgId: string;
  member: Member;
  teams: Team[];
  isSelf: boolean;
  actorRole: Role;
  canManage: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const { submit, pending, error } = useSubmit();
  const path = { params: { path: { orgId, memberId: member.id } } };
  const editable = canManage && canAssignRole(actorRole, member.role, member.role);
  const roles = assignableRoles(actorRole);

  const update = (body: { role?: Role; teamId?: string | null }) => {
    submit(() => api.PATCH('/api/v1/orgs/{orgId}/members/{memberId}', { ...path, body }));
  };

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {member.name} {isSelf ? <span className="text-muted-foreground">(you)</span> : null}
          </p>
          <p className="truncate text-sm text-muted-foreground">{member.email}</p>
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={`Role of ${member.name}`}
              className="h-8 w-36 text-sm"
              value={member.role}
              disabled={pending}
              onChange={(e) => {
                update({ role: e.target.value as Role });
              }}
            >
              {(roles.includes(member.role) ? roles : [member.role, ...roles]).map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={`Team of ${member.name}`}
              className="h-8 w-36 text-sm"
              value={member.teamId ?? ''}
              disabled={pending}
              onChange={(e) => {
                update({ teamId: e.target.value === '' ? null : e.target.value });
              }}
            >
              <option value="">No team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
            {confirming ? (
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => {
                  submit(() => api.DELETE('/api/v1/orgs/{orgId}/members/{memberId}', path));
                }}
              >
                Confirm removal
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Remove
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Badge>{roleLabel(member.role)}</Badge>
            {member.teamId === null ? null : <Badge>{teams.find((t) => t.id === member.teamId)?.name ?? 'team'}</Badge>}
          </div>
        )}
      </div>
      <FormError message={error} />
    </li>
  );
}
