'use client';

import { useState } from 'react';
import { SecretOnce } from '@/components/secret-once';
import { Badge, EmptyState } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormError, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Connection, Credential } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

export function KeysTable({
  orgId,
  credentials,
  connections,
  principals,
  canManage,
}: {
  orgId: string;
  credentials: Credential[];
  connections: Connection[];
  principals: { id: string; name: string }[];
  canManage: boolean;
}) {
  const { submit, pending, error } = useSubmit();
  const [created, setCreated] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');
  const [principalId, setPrincipalId] = useState('');

  return (
    <div className="space-y-6">
      {created === null ? null : (
        <SecretOnce
          label="New provider key"
          secret={created}
          onDone={() => {
            setCreated(null);
          }}
        />
      )}
      {credentials.length === 0 ? (
        <EmptyState>Keys appear here after a provider is connected.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-normal">Key</th>
                <th className="py-2 pr-4 font-normal">Provider</th>
                <th className="py-2 pr-4 font-normal">Belongs to</th>
                <th className="py-2 pr-4 font-normal">Limit</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {credentials.map((credential) => (
                <tr key={credential.id} className="align-middle">
                  <td className="py-2 pr-4">
                    <p>{credential.name}</p>
                    {credential.hint === null ? null : (
                      <p className="font-mono text-xs text-muted-foreground">{credential.hint}</p>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {credential.provider}{' '}
                    {credential.status === 'active' ? null : <Badge tone="danger">{credential.status}</Badge>}
                  </td>
                  <td className="py-2 pr-4">
                    {canManage && credential.status !== 'revoked' ? (
                      <Select
                        aria-label={`Owner of ${credential.name}`}
                        className="h-8 text-sm"
                        value={credential.principal?.id ?? ''}
                        disabled={pending}
                        onChange={(e) => {
                          const value = e.target.value;
                          submit(() =>
                            api.PATCH('/api/v1/orgs/{orgId}/credentials/{credentialId}', {
                              params: { path: { orgId, credentialId: credential.id } },
                              body: { principalId: value === '' ? null : value },
                            }),
                          );
                        }}
                      >
                        <option value="">Unassigned</option>
                        {principals.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      (credential.principal?.name ?? <span className="text-danger">Unassigned</span>)
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono">{credential.limit === null ? '—' : `$${credential.limit}`}</td>
                  <td className="py-2 text-right">
                    {canManage && credential.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          submit(() =>
                            api.POST('/api/v1/orgs/{orgId}/credentials/{credentialId}/revoke', {
                              params: { path: { orgId, credentialId: credential.id } },
                            }),
                          );
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && connections.length > 0 ? (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(async () => {
              const result = await api.POST('/api/v1/orgs/{orgId}/connections/{connectionId}/credentials', {
                params: { path: { orgId, connectionId } },
                body: { principalId },
              });
              if (result.data !== undefined) setCreated(result.data.secret);
              return result;
            });
          }}
        >
          <p className="w-full text-sm text-muted-foreground">
            Create a provider key for someone. Its provider-side limit tracks their remaining budget.
          </p>
          <Select
            aria-label="Provider"
            className="w-40"
            value={connectionId}
            onChange={(e) => {
              setConnectionId(e.target.value);
            }}
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Person or agent"
            className="w-56"
            required
            value={principalId}
            onChange={(e) => {
              setPrincipalId(e.target.value);
            }}
          >
            <option value="" disabled>
              For…
            </option>
            {principals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={pending || principalId === ''}>
            Create key
          </Button>
        </form>
      ) : null}
      <FormError message={error} />
    </div>
  );
}
