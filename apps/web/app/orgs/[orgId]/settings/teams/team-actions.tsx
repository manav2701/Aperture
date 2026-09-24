'use client';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Team } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

export function TeamActions({ orgId, team }: { orgId: string; team: Team }) {
  const { submit, pending, error } = useSubmit();
  return (
    <div className="flex items-center gap-2">
      <FormError message={error} />
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          submit(() =>
            api.PATCH('/api/v1/orgs/{orgId}/teams/{teamId}', {
              params: { path: { orgId, teamId: team.id } },
              body: { archived: !team.archived },
            }),
          );
        }}
      >
        {team.archived ? 'Restore' : 'Archive'}
      </Button>
    </div>
  );
}
