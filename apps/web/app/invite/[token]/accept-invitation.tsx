'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();

  const accept = () => {
    let orgId: string | undefined;
    submit(
      async () => {
        const result = await api.POST('/api/v1/invitations/accept', { body: { token } });
        orgId = result.data?.orgId;
        return result;
      },
      () => {
        if (orgId !== undefined) router.push(`/orgs/${orgId}`);
      },
    );
  };

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <Button onClick={accept} disabled={pending}>
        Accept invitation
      </Button>
    </div>
  );
}
