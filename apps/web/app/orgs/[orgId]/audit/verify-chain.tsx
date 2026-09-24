'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api/browser';

export function VerifyChain({ orgId }: { orgId: string }) {
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const verify = () => {
    startTransition(async () => {
      const { data, error } = await api.GET('/api/v1/orgs/{orgId}/audit/verify', { params: { path: { orgId } } });
      if (data === undefined) setResult(errorMessage(error));
      else if (data.ok) setResult(`Intact: ${String(data.records)} records · root ${data.root?.slice(0, 12) ?? '—'}…`);
      else setResult(`Broken at #${String(data.failure?.seq)}: ${data.failure?.reason ?? 'unknown'}`);
    });
  };

  return (
    <div className="flex items-center gap-3">
      {result === null ? null : (
        <span role="status" className="font-mono text-xs text-muted-foreground">
          {result}
        </span>
      )}
      <Button variant="secondary" onClick={verify} disabled={pending}>
        Verify chain
      </Button>
    </div>
  );
}
