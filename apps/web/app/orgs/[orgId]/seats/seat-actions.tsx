'use client';

import { parseCsv, parseStatementDate } from '@aperture/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

interface Provider {
  provider: 'seat:cursor' | 'seat:claude_enterprise' | 'seat:claude_code' | 'seat:github_copilot' | 'seat:m365_copilot';
  name: string;
  secretLabel: string;
  secretUrl: string;
  requires: string;
  steps: string[];
  configFields: { key: string; label: string; required: boolean }[];
}

export function ConnectSeats({ orgId, providers }: { orgId: string; providers: Provider[] }) {
  const { submit, pending, error } = useSubmit();
  const [provider, setProvider] = useState<Provider['provider']>(providers[0]?.provider ?? 'seat:cursor');
  const [secret, setSecret] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const info = providers.find((p) => p.provider === provider);
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer font-medium">Connect a product</summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(
            () =>
              api.POST('/api/v1/orgs/{orgId}/seat-connections', {
                params: { path: { orgId } },
                body: { provider, secret, config },
              }),
            () => {
              setSecret('');
            },
          );
        }}
      >
        <Field label="Product" htmlFor="seat-provider">
          <Select
            id="seat-provider"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as Provider['provider']);
              setConfig({});
            }}
          >
            {providers.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {info === undefined ? null : (
          <>
            <p className="text-xs text-muted-foreground">Needs: {info.requires}</p>
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              {info.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <a href={info.secretUrl} target="_blank" rel="noreferrer" className="text-xs underline">
              Open {info.name}
            </a>
            {info.configFields.map((field) => (
              <Field key={field.key} label={field.label} htmlFor={`seat-config-${field.key}`}>
                <Input
                  id={`seat-config-${field.key}`}
                  required={field.required}
                  value={config[field.key] ?? ''}
                  onChange={(e) => {
                    setConfig({ ...config, [field.key]: e.target.value });
                  }}
                />
              </Field>
            ))}
            <Field
              label={info.secretLabel}
              htmlFor="seat-secret"
              hint="Tested, then stored encrypted; never shown again. Aperture only reads."
            >
              {provider === 'seat:m365_copilot' ? (
                <Textarea
                  id="seat-secret"
                  rows={3}
                  value={secret}
                  required
                  onChange={(e) => {
                    setSecret(e.target.value);
                  }}
                />
              ) : (
                <Input
                  id="seat-secret"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  required
                  onChange={(e) => {
                    setSecret(e.target.value);
                  }}
                />
              )}
            </Field>
          </>
        )}
        <FormError message={error} />
        <Button type="submit" disabled={pending}>
          {pending ? 'Testing…' : 'Connect'}
        </Button>
      </form>
    </details>
  );
}

export function SeatConnectionActions({ orgId, connectionId }: { orgId: string; connectionId: string }) {
  const { submit, pending, error } = useSubmit();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          submit(() =>
            api.POST('/api/v1/orgs/{orgId}/seat-connections/{connectionId}/sync', {
              params: { path: { orgId, connectionId } },
            }),
          );
        }}
      >
        Sync now
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          submit(() =>
            api.DELETE('/api/v1/orgs/{orgId}/seat-connections/{connectionId}', {
              params: { path: { orgId, connectionId } },
            }),
          );
        }}
      >
        Disconnect
      </Button>
      <FormError message={error} />
    </div>
  );
}

interface Seat {
  id: string;
  holder: { userId: string } | null;
  payer: 'company' | 'personal_expensed' | 'personal_unexpensed' | 'unknown';
  monthlyCost: string | null;
}

export function EditSeat({
  orgId,
  seat,
  people,
}: {
  orgId: string;
  seat: Seat;
  people: { userId: string; name: string; email: string }[];
}) {
  const { submit, pending, error } = useSubmit();
  const [userId, setUserId] = useState(seat.holder?.userId ?? '');
  const [payer, setPayer] = useState(seat.payer);
  const [cost, setCost] = useState(seat.monthlyCost ?? '');
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Edit</summary>
      <form
        className="mt-2 w-56 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit(() =>
            api.PATCH('/api/v1/orgs/{orgId}/seats/{seatId}', {
              params: { path: { orgId, seatId: seat.id } },
              body: {
                ...(people.length > 0 ? { userId: userId === '' ? null : userId } : {}),
                payer,
                monthlyCostUsd: cost === '' ? null : cost,
              },
            }),
          );
        }}
      >
        {people.length === 0 ? null : (
          <Select
            aria-label="Holder"
            className="h-8 text-xs"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
            }}
          >
            <option value="">Unlinked</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name} ({p.email})
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="Payer"
          className="h-8 text-xs"
          value={payer}
          onChange={(e) => {
            setPayer(e.target.value as Seat['payer']);
          }}
        >
          <option value="company">Company</option>
          <option value="personal_expensed">Personal, expensed</option>
          <option value="personal_unexpensed">Personal</option>
          <option value="unknown">Unknown</option>
        </Select>
        <Input
          aria-label="Monthly cost (USD)"
          placeholder="Monthly cost USD"
          className="h-8 text-xs"
          value={cost}
          pattern="\d+(\.\d{1,6})?"
          onChange={(e) => {
            setCost(e.target.value);
          }}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              submit(() =>
                api.PATCH('/api/v1/orgs/{orgId}/seats/{seatId}', {
                  params: { path: { orgId, seatId: seat.id } },
                  body: { status: 'cancelled' },
                }),
              );
            }}
          >
            Cancel seat
          </Button>
        </div>
        <FormError message={error} />
      </form>
    </details>
  );
}

interface Tool {
  id: string;
  product: string;
  plans: { id: string; name: string }[];
}

/** Admin-console exports (ChatGPT, Gemini, …) are parsed here; only email, plan, and last activity are sent. */
export function ImportSeats({ orgId, tools }: { orgId: string; tools: Tool[] }) {
  const { submit, pending, error, setError } = useSubmit();
  const [toolId, setToolId] = useState('chatgpt');
  const [plan, setPlan] = useState('');
  const [rows, setRows] = useState<{ email: string; lastActiveAt?: string | null }[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const tool = tools.find((t) => t.id === toolId);

  const onFile = async (file: File) => {
    setDone(null);
    const table = parseCsv(await file.text());
    const header = (table[0] ?? []).map((h) => h.toLowerCase());
    const emailCol = header.findIndex((h) => /e-?mail/.test(h));
    const activeCol = header.findIndex((h) => /last.*(active|activity|seen|used)/.test(h));
    if (emailCol < 0) {
      setError('No email column found. The export needs a column named "email".');
      return;
    }
    setRows(
      table
        .slice(1)
        .map((cells) => ({
          email: (cells[emailCol] ?? '').trim().toLowerCase(),
          lastActiveAt: activeCol < 0 ? null : (parseStatementDate(cells[activeCol] ?? '', 'mdy') ?? null),
        }))
        .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)),
    );
  };

  return (
    <div className="space-y-3 text-sm">
      <FormNotice>
        For ChatGPT Business/Enterprise, Gemini, and other tools without a connector: export the member list from the
        admin console as CSV.
      </FormNotice>
      <Field label="Tool" htmlFor="import-tool">
        <Select
          id="import-tool"
          value={toolId}
          onChange={(e) => {
            setToolId(e.target.value);
            setPlan('');
          }}
        >
          {tools.map((t) => (
            <option key={t.id} value={t.id}>
              {t.product}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Plan" htmlFor="import-plan">
        <Select
          id="import-plan"
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
          }}
        >
          <option value="">Unknown</option>
          {tool?.plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Input
        type="file"
        accept=".csv,text/csv"
        className="py-2"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) void onFile(f);
        }}
      />
      {rows.length === 0 ? null : (
        <Button
          disabled={pending}
          onClick={() => {
            submit(
              () =>
                api.POST('/api/v1/orgs/{orgId}/seats/import', {
                  params: { path: { orgId } },
                  body: { toolId, plan: plan === '' ? null : plan, rows },
                }),
              () => {
                setDone(`Imported ${String(rows.length)} seats.`);
                setRows([]);
              },
            );
          }}
        >
          Import {rows.length} seats
        </Button>
      )}
      {done === null ? null : <FormNotice>{done}</FormNotice>}
      <FormError message={error} />
    </div>
  );
}
