'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api/browser';

/** Sends the browser to Stripe Checkout or the Customer Portal. */
export function BillingActions({ orgId, hasSubscription }: { orgId: string; hasSubscription: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (call: () => Promise<{ data?: { url: string }; error?: unknown }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await call();
      if (result.data === undefined) setError(errorMessage(result.error));
      else window.location.assign(result.data.url);
    } catch {
      setError('Could not reach Aperture.');
    } finally {
      setBusy(false);
    }
  };
  const path = { params: { path: { orgId } } };
  return (
    <div className="space-y-3">
      {hasSubscription ? (
        <Button
          disabled={busy}
          onClick={() => {
            void go(() => api.POST('/api/v1/orgs/{orgId}/billing/portal', path));
          }}
        >
          Manage subscription and invoices
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              void go(() => api.POST('/api/v1/orgs/{orgId}/billing/checkout', { ...path, body: { plan: 'team' } }));
            }}
          >
            Team — USD 49 / month
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void go(() => api.POST('/api/v1/orgs/{orgId}/billing/checkout', { ...path, body: { plan: 'business' } }));
            }}
          >
            Business — USD 499 / month
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
