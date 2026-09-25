'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormError, FormNotice, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Connection } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

export function ConnectionActions({ orgId, connection }: { orgId: string; connection: Connection }) {
  const { submit, pending, error } = useSubmit();
  const [notice, setNotice] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [confirming, setConfirming] = useState(false);
  const path = { params: { path: { orgId, connectionId: connection.id } } };
  // Gemini and Hugging Face use the connection's own key; OpenRouter/OpenAI create one; Anthropic needs a pasted key.
  const needsGatewayKey =
    !connection.gatewayReady && connection.provider !== 'google' && connection.provider !== 'huggingface';
  const pasteRequired = needsGatewayKey && !connection.capabilities.createKey;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap gap-2">
        {connection.capabilities.usage === 'none' ? null : (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setNotice(null);
              submit(async () => {
                const result = await api.POST('/api/v1/orgs/{orgId}/connections/{connectionId}/sync', path);
                if (result.data !== undefined)
                  setNotice(
                    `Synced ${String(result.data.keys)} keys, imported ${String(result.data.imported)} usage records.`,
                  );
                return result;
              });
            }}
          >
            Sync now
          </Button>
        )}
        {needsGatewayKey && !pasteRequired ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              submit(() =>
                api.POST('/api/v1/orgs/{orgId}/connections/{connectionId}/gateway-key', { ...path, body: {} }),
              );
            }}
          >
            Set up gateway
          </Button>
        ) : null}
        {confirming ? (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              submit(() => api.DELETE('/api/v1/orgs/{orgId}/connections/{connectionId}', path));
            }}
          >
            Confirm disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Disconnect
          </Button>
        )}
      </div>
      {pasteRequired ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(
              () =>
                api.POST('/api/v1/orgs/{orgId}/connections/{connectionId}/gateway-key', {
                  ...path,
                  body: { secret: pasted },
                }),
              () => {
                setPasted('');
              },
            );
          }}
        >
          <Input
            type="password"
            aria-label="API key for the gateway"
            placeholder="API key for the gateway to use"
            className="h-8 text-sm"
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
            }}
          />
          <Button type="submit" size="sm" disabled={pending || pasted.length < 8}>
            Save
          </Button>
        </form>
      ) : null}
      {notice === null ? null : <FormNotice>{notice}</FormNotice>}
      <FormError message={error} />
    </div>
  );
}
