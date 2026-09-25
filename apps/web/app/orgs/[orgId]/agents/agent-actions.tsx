'use client';

import { useState } from 'react';
import { SecretOnce } from '@/components/secret-once';
import { Button } from '@/components/ui/button';
import { FormError, FormNotice, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

type Status = 'active' | 'paused' | 'revoked';

export function AgentActions({ orgId, agentId, status }: { orgId: string; agentId: string; status: Status }) {
  const { submit, pending, error } = useSubmit();
  const [secret, setSecret] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const path = { params: { path: { orgId, principalId: agentId } } };
  const setStatus = (next: Status) => {
    submit(() => api.POST('/api/v1/orgs/{orgId}/principals/{principalId}/status', { ...path, body: { status: next } }));
  };

  if (status === 'revoked') return null;
  return (
    <div className="space-y-3 border-t border-border pt-3">
      {secret === null ? null : (
        <SecretOnce
          label="New gateway key"
          secret={secret}
          onDone={() => {
            setSecret(null);
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {status === 'active' ? (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              setStatus('paused');
            }}
          >
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              setStatus('active');
            }}
          >
            Resume
          </Button>
        )}
        {confirmRevoke ? (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              setStatus('revoked');
            }}
          >
            Confirm revoke (permanent)
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirmRevoke(true);
            }}
          >
            Revoke
          </Button>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(async () => {
              const result = await api.POST('/api/v1/orgs/{orgId}/principals/{principalId}/keys', {
                ...path,
                body: { name: keyName },
              });
              if (result.data !== undefined) {
                setSecret(result.data.key);
                setKeyName('');
              }
              return result;
            });
          }}
        >
          <Input
            aria-label="Key name"
            placeholder="Key name, e.g. production"
            className="h-8 w-48 text-sm"
            required
            value={keyName}
            onChange={(e) => {
              setKeyName(e.target.value);
            }}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            New key
          </Button>
        </form>
      </div>
      <FormError message={error} />
    </div>
  );
}

export function RevokeKey({ orgId, keyId }: { orgId: string; keyId: string }) {
  const { submit, pending, error } = useSubmit();
  return (
    <>
      <FormError message={error} />
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          submit(() => api.DELETE('/api/v1/orgs/{orgId}/keys/{keyId}', { params: { path: { orgId, keyId } } }));
        }}
      >
        Revoke
      </Button>
    </>
  );
}

export function PauseAll({ orgId }: { orgId: string }) {
  const { submit, pending, error } = useSubmit();
  const [confirming, setConfirming] = useState(false);
  const [paused, setPaused] = useState<number | null>(null);
  return (
    <div className="flex items-center gap-3">
      {paused === null ? null : <FormNotice>Paused {paused} agents.</FormNotice>}
      <FormError message={error} />
      {confirming ? (
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => {
            submit(
              async () => {
                const result = await api.POST('/api/v1/orgs/{orgId}/agents/pause-all', { params: { path: { orgId } } });
                if (result.data !== undefined) setPaused(result.data.paused);
                return result;
              },
              () => {
                setConfirming(false);
              },
            );
          }}
        >
          Confirm: pause every agent
        </Button>
      ) : (
        <Button
          variant="danger"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Pause all agents
        </Button>
      )}
    </div>
  );
}
