'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function presetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  if (preset === 'last-month') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: isoDay(from), to: isoDay(to) };
  }
  if (preset === 'last-quarter') {
    const quarter = Math.floor(now.getUTCMonth() / 3);
    const from = new Date(Date.UTC(now.getUTCFullYear(), (quarter - 1) * 3, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), quarter * 3, 1));
    return { from: isoDay(from), to: isoDay(to) };
  }
  return { from: isoDay(new Date(now.getTime() - 30 * 86_400_000)), to: isoDay(new Date(now.getTime() + 86_400_000)) };
}

export function NewAttestation({ orgId }: { orgId: string }) {
  const { submit, pending, error } = useSubmit();
  const [preset, setPreset] = useState('last-30');
  const [range, setRange] = useState(presetRange('last-30'));
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const to = new Date(`${range.to}T00:00:00Z`);
        submit(() =>
          api.POST('/api/v1/orgs/{orgId}/attestations', {
            params: { path: { orgId } },
            body: {
              from: new Date(`${range.from}T00:00:00Z`).toISOString(),
              to: new Date(Math.min(to.getTime(), Date.now())).toISOString(),
            },
          }),
        );
      }}
    >
      <Field label="Period" htmlFor="att-preset">
        <Select
          id="att-preset"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            if (e.target.value !== 'custom') setRange(presetRange(e.target.value));
          }}
        >
          <option value="last-30">Last 30 days</option>
          <option value="last-month">Last calendar month</option>
          <option value="last-quarter">Last quarter</option>
          <option value="custom">Custom</option>
        </Select>
      </Field>
      {preset === 'custom' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From" htmlFor="att-from">
            <Input
              id="att-from"
              type="date"
              value={range.from}
              onChange={(e) => {
                setRange({ ...range, from: e.target.value });
              }}
            />
          </Field>
          <Field label="To" htmlFor="att-to">
            <Input
              id="att-to"
              type="date"
              value={range.to}
              onChange={(e) => {
                setRange({ ...range, to: e.target.value });
              }}
            />
          </Field>
        </div>
      ) : null}
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Signing…' : 'Build and sign'}
      </Button>
    </form>
  );
}

interface Share {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  views: number;
}

export function ShareLinks({ orgId, attestationId }: { orgId: string; attestationId: string }) {
  const { submit, pending, error } = useSubmit();
  const [shares, setShares] = useState<Share[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [days, setDays] = useState('30');
  const load = () => {
    void api
      .GET('/api/v1/orgs/{orgId}/attestations/{attestationId}/shares', { params: { path: { orgId, attestationId } } })
      .then((result) => {
        setShares(result.data?.shares ?? []);
      });
  };

  return (
    <details
      className="mt-3 text-sm"
      onToggle={(e) => {
        if (e.currentTarget.open) load();
      }}
    >
      <summary className="cursor-pointer text-muted-foreground">Share links</summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-end gap-2">
          <Field label="Expires after (days, max 90)" htmlFor={`share-days-${attestationId}`}>
            <Input
              id={`share-days-${attestationId}`}
              type="number"
              min={1}
              max={90}
              className="w-28"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
              }}
            />
          </Field>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              submit(async () => {
                const result = await api.POST('/api/v1/orgs/{orgId}/attestations/{attestationId}/shares', {
                  params: { path: { orgId, attestationId } },
                  body: { expiresInDays: Number(days) },
                });
                if (result.data !== undefined) setCreated(result.data.url);
                load();
                return result;
              });
            }}
          >
            Create link
          </Button>
        </div>
        {created === null ? null : (
          <FormNotice>
            Copy this link now; it isn’t shown again: <span className="break-all font-mono text-xs">{created}</span>
          </FormNotice>
        )}
        <ul className="divide-y divide-border">
          {shares.map((share) => (
            <li key={share.id} className="flex items-center justify-between gap-2 py-1">
              <span className="text-xs">
                {share.revokedAt === null ? `expires ${share.expiresAt.slice(0, 10)}` : 'revoked'} · {share.views}{' '}
                view(s)
              </span>
              {share.revokedAt === null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    submit(async () => {
                      const result = await api.DELETE(
                        '/api/v1/orgs/{orgId}/attestations/{attestationId}/shares/{shareId}',
                        {
                          params: { path: { orgId, attestationId, shareId: share.id } },
                        },
                      );
                      load();
                      return result;
                    });
                  }}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <FormError message={error} />
      </div>
    </details>
  );
}
