'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api/browser';

/** Sends the browser to Slack to install the Aperture app (interactive Approve / Deny). */
export function SlackInstall({ orgId }: { orgId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void api
            .GET('/api/v1/orgs/{orgId}/slack/install', { params: { path: { orgId } } })
            .then((result) => {
              if (result.data === undefined) {
                setError(errorMessage(result.error));
                setPending(false);
                return;
              }
              window.location.assign(result.data.url);
            })
            .catch(() => {
              setError('Could not reach Aperture.');
              setPending(false);
            });
        }}
      >
        Install the Slack app
      </Button>
      <FormError message={error} />
    </div>
  );
}
