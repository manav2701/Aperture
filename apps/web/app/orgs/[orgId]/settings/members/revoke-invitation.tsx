'use client';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function RevokeInvitation({ orgId, invitationId }: { orgId: string; invitationId: string }) {
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
            api.DELETE('/api/v1/orgs/{orgId}/invitations/{invitationId}', {
              params: { path: { orgId, invitationId } },
            }),
          );
        }}
      >
        Revoke
      </Button>
    </div>
  );
}
