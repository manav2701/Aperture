'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

type CatalogueTool = { id: string; product: string; approved: boolean; plans: { id: string; name: string }[] };
type Payer = 'company' | 'personal_expensed' | 'personal_unexpensed';
type Entry = { toolId: string; plan: string | null; payer: Payer; monthlyCostUsd: string | null };

export function DeclareTools({
  orgId,
  catalogue,
  current,
}: {
  orgId: string;
  catalogue: CatalogueTool[];
  current: { toolId: string; plan: string | null; payer: string; source: string; monthlyCost: string | null }[];
}) {
  const { submit, pending, error } = useSubmit();
  const declared = current.filter((t) => t.source === 'declared');
  const others = current.filter((t) => t.source !== 'declared');
  const [entries, setEntries] = useState<Entry[]>(
    declared.map((t) => ({
      toolId: t.toolId,
      plan: t.plan,
      payer: (t.payer === 'unknown' ? 'company' : t.payer) as Payer,
      monthlyCostUsd: t.monthlyCost,
    })),
  );
  const [adding, setAdding] = useState('');
  const update = (index: number, change: Partial<Entry>) => {
    setEntries(entries.map((e, i) => (i === index ? { ...e, ...change } : e)));
  };
  const product = (id: string) => catalogue.find((t) => t.id === id);

  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        submit(() => api.PUT('/api/v1/orgs/{orgId}/me/tools', { params: { path: { orgId } }, body: { tools: entries } }));
      }}
    >
      {others.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          Already known from {[...new Set(others.map((o) => o.source))].join(' and ')}: {others.map((o) => product(o.toolId)?.product ?? o.toolId).join(', ')}.
        </p>
      )}
      {entries.length === 0 ? <p className="text-muted-foreground">No tools declared.</p> : null}
      <ul className="space-y-2">
        {entries.map((entry, index) => {
          const tool = product(entry.toolId);
          return (
            <li key={entry.toolId} className="grid gap-2 border border-border p-2 md:grid-cols-[1fr_9rem_10rem_7rem_auto] md:items-center">
              <span>
                {tool?.product ?? entry.toolId} {tool?.approved === true ? <Badge tone="accent">approved</Badge> : null}
              </span>
              <Select aria-label="Plan" className="h-8 text-xs" value={entry.plan ?? ''} onChange={(e) => { update(index, { plan: e.target.value === '' ? null : e.target.value }); }}>
                <option value="">Plan…</option>
                {tool?.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Who pays" className="h-8 text-xs" value={entry.payer} onChange={(e) => { update(index, { payer: e.target.value as Payer }); }}>
                <option value="company">Company pays</option>
                <option value="personal_expensed">I pay, then expense it</option>
                <option value="personal_unexpensed">I pay personally</option>
              </Select>
              <Input aria-label="Monthly cost USD" placeholder="USD / month" className="h-8 text-xs" value={entry.monthlyCostUsd ?? ''} pattern="\d+(\.\d{1,6})?" onChange={(e) => { update(index, { monthlyCostUsd: e.target.value === '' ? null : e.target.value }); }} />
              <Button size="sm" variant="ghost" onClick={() => { setEntries(entries.filter((_, i) => i !== index)); }}>
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Select aria-label="Add a tool" className="h-9" value={adding} onChange={(e) => { setAdding(e.target.value); }}>
          <option value="">Add a tool…</option>
          {catalogue
            .filter((t) => !entries.some((e) => e.toolId === t.id))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.product}
              </option>
            ))}
        </Select>
        <Button
          variant="secondary"
          disabled={adding === ''}
          onClick={() => {
            setEntries([...entries, { toolId: adding, plan: null, payer: 'company', monthlyCostUsd: null }]);
            setAdding('');
          }}
        >
          Add
        </Button>
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        Save and confirm
      </Button>
    </form>
  );
}

export function ConfirmTools({ orgId, confirmed }: { orgId: string; confirmed: boolean }) {
  const { submit, pending } = useSubmit();
  if (confirmed) return <Badge tone="accent">confirmed</Badge>;
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => { submit(() => api.POST('/api/v1/orgs/{orgId}/me/tools/confirm', { params: { path: { orgId } } })); }}>
      Still accurate
    </Button>
  );
}

export function ReceiptUpload({ orgId }: { orgId: string }) {
  const { submit, pending, error } = useSubmit();
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="mt-3 space-y-2 text-sm">
      <Field label="Or upload a receipt email (.eml)" htmlFor="receipt-file">
        <Input
          id="receipt-file"
          type="file"
          accept=".eml,message/rfc822"
          className="py-2"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file === undefined) return;
            void file.arrayBuffer().then((buffer) => {
              let binary = '';
              const bytes = new Uint8Array(buffer);
              for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
              submit(async () => {
                const response = await api.POST('/api/v1/orgs/{orgId}/me/receipts', { params: { path: { orgId } }, body: { eml: btoa(binary) } });
                if (response.data !== undefined)
                  setResult(
                    response.data.duplicate
                      ? 'Already received.'
                      : response.data.status === 'imported'
                        ? `Added: ${response.data.toolId ?? ''} ${response.data.amount ?? ''} ${response.data.currency ?? ''}`
                        : `Sent for review: ${response.data.reason ?? ''}`,
                  );
                return response;
              });
            });
          }}
        />
      </Field>
      {result === null ? null : <FormNotice>{result}</FormNotice>}
      <FormError message={error} />
    </div>
  );
}

type Token = { id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null };

/** A telemetry token and the exact settings for Claude Code (metrics only; prompt logging stays off). */
export function TelemetrySetup({ orgId, tokens, gatewayUrl }: { orgId: string; tokens: Token[]; gatewayUrl: string | null }) {
  const { submit, pending, error } = useSubmit();
  const [created, setCreated] = useState<{ token: string; endpoint: string | null } | null>(null);
  const endpoint = created?.endpoint ?? (gatewayUrl === null ? '<gateway URL>/otlp' : `${gatewayUrl.replace(/\/$/, '')}/otlp`);
  const settings = created === null ? null : JSON.stringify(
    {
      env: {
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_LOGS_EXPORTER: 'none',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${created.token}`,
        OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
      },
    },
    null,
    2,
  );
  const live = tokens.filter((t) => t.revokedAt === null);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Claude Code sends usage metrics (sessions, tokens, estimated cost) to Aperture, even on a Pro or Max subscription. Prompts and code are never sent.
      </p>
      {created === null ? (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            submit(async () => {
              const response = await api.POST('/api/v1/orgs/{orgId}/me/telemetry-tokens', {
                params: { path: { orgId } },
                body: { tool: 'claude_code', name: 'laptop' },
              });
              if (response.data !== undefined) setCreated({ token: response.data.token, endpoint: response.data.endpoint });
              return response;
            });
          }}
        >
          Create a telemetry token
        </Button>
      ) : (
        <>
          <FormNotice>Copy this now; the token isn’t shown again.</FormNotice>
          <Field label="Run in a terminal" htmlFor="connect-cmd">
            <Input id="connect-cmd" readOnly className="font-mono text-xs" value={`npx @aperture/connect claude-code --token ${created.token} --endpoint ${endpoint}`} />
          </Field>
          <Field label="Or add to ~/.claude/settings.json" htmlFor="connect-json">
            <Textarea id="connect-json" readOnly rows={11} value={settings ?? ''} />
          </Field>
        </>
      )}
      {live.length === 0 ? null : (
        <ul className="divide-y divide-border">
          {live.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-1 text-xs">
              <span>
                <span className="font-mono">{t.prefix}…</span> {t.name} · {t.lastUsedAt === null ? 'never used' : `last data ${t.lastUsedAt.slice(0, 10)}`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  submit(() => api.DELETE('/api/v1/orgs/{orgId}/telemetry-tokens/{tokenId}', { params: { path: { orgId, tokenId: t.id } } }));
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FormError message={error} />
    </div>
  );
}
