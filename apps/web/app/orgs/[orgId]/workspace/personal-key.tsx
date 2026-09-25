'use client';

import { useState, type SubmitEvent } from 'react';
import { SecretOnce } from '@/components/secret-once';
import { Button } from '@/components/ui/button';
import { FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function PersonalKey({ orgId, gatewayUrl }: { orgId: string; gatewayUrl: string | null }) {
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const { submit, pending, error } = useSubmit();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submit(async () => {
      const result = await api.POST('/api/v1/orgs/{orgId}/me/keys', { params: { path: { orgId } }, body: { name } });
      if (result.data !== undefined) {
        setSecret(result.data.key);
        setName('');
      }
      return result;
    });
  };

  return (
    <div className="space-y-4">
      {secret === null ? null : (
        <SecretOnce
          label="Your gateway key"
          secret={secret}
          onDone={() => {
            setSecret(null);
          }}
        />
      )}
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          aria-label="Key name"
          placeholder="e.g. laptop"
          required
          maxLength={80}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          Create
        </Button>
      </form>
      <FormError message={error} />
      {gatewayUrl === null ? null : (
        <p className="text-xs text-muted-foreground">
          Base URL: <code className="font-mono">{gatewayUrl}/v1</code>
        </p>
      )}
    </div>
  );
}
