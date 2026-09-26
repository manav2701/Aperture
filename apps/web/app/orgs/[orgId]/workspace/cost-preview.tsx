'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

export interface Preview {
  allowed: boolean;
  outcome?: string;
  estimate_usd: string | null;
  remaining_after_usd?: string | null;
  reasons?: { message: string }[];
}

/**
 * Asks the gateway what a request would cost and whether it's allowed, 400 ms after the last
 * change, without reserving anything.
 */
export function useCostPreview(orgId: string, request: Record<string, unknown> | null): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(null);
  const key = JSON.stringify(request);
  useEffect(() => {
    if (request === null) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/v1/orgs/${orgId}/workspace/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: key,
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as Preview & { error?: { message?: string } };
          setPreview(
            response.ok
              ? body
              : { allowed: false, estimate_usd: null, reasons: [{ message: body.error?.message ?? 'Not available' }] },
          );
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` (the serialised request) stands in for `request`, so equal requests don't refetch.
  }, [orgId, key]);
  return preview;
}

export function CostPreview({ preview }: { preview: Preview | null }) {
  if (preview === null) return null;
  const why = preview.reasons?.map((reason) => reason.message).join('; ');
  return (
    <p
      role="status"
      className={cn(
        'border-l-2 pl-3 text-sm',
        preview.allowed ? 'border-accent text-muted-foreground' : 'border-danger text-danger',
      )}
    >
      {preview.estimate_usd === null ? 'No price available. ' : `Up to $${preview.estimate_usd}. `}
      {preview.allowed
        ? preview.remaining_after_usd == null
          ? 'Allowed.'
          : `Allowed; about $${preview.remaining_after_usd} would be left.`
        : preview.outcome === 'budget_exceeded'
          ? 'This exceeds your remaining budget.'
          : (why ?? 'Not allowed by policy.')}
    </p>
  );
}
