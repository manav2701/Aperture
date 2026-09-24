'use client';

import { useState, useTransition, type SubmitEvent } from 'react';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api/browser';
import type { Decision } from '@/lib/api/types';

type Rail = 'gateway' | 'provider' | 'card' | 'x402';

const outcomeLabel = { allow: 'Allowed', deny: 'Denied', require_approval: 'Needs approval' } as const;

export function PolicySimulator({ orgId, principals }: { orgId: string; principals: { id: string; name: string }[] }) {
  const [principalId, setPrincipalId] = useState(principals[0]?.id ?? '');
  const [rail, setRail] = useState<Rail>('provider');
  const [amount, setAmount] = useState('1.00');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('openai/gpt-5-mini');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const aiRail = rail === 'gateway' || rail === 'provider';

  const simulate = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const { data, error: failure } = await api.POST('/api/v1/orgs/{orgId}/policies/simulate', {
        params: { path: { orgId } },
        body: {
          ...(principalId === '' ? {} : { principalId }),
          action: { rail, amount, ...(aiRail ? { provider, model } : {}) },
        },
      });
      if (data === undefined) {
        setDecision(null);
        setError(errorMessage(failure));
      } else {
        setDecision(data);
      }
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={simulate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Who" htmlFor="sim-principal">
          <Select
            id="sim-principal"
            value={principalId}
            onChange={(e) => {
              setPrincipalId(e.target.value);
            }}
          >
            <option value="">Anyone (organization policy only)</option>
            {principals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rail" htmlFor="sim-rail">
          <Select
            id="sim-rail"
            value={rail}
            onChange={(e) => {
              setRail(e.target.value as Rail);
            }}
          >
            <option value="provider">AI provider key</option>
            <option value="gateway">Aperture gateway</option>
            <option value="card">Card</option>
            <option value="x402">x402 (Solana)</option>
          </Select>
        </Field>
        <Field label="Amount (USD)" htmlFor="sim-amount">
          <Input
            id="sim-amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
          />
        </Field>
        {aiRail ? (
          <>
            <Field label="Provider" htmlFor="sim-provider">
              <Input
                id="sim-provider"
                required
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                }}
              />
            </Field>
            <Field label="Model" htmlFor="sim-model">
              <Input
                id="sim-model"
                required
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                }}
              />
            </Field>
          </>
        ) : null}
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={pending} className="w-full">
            Simulate
          </Button>
        </div>
      </form>

      <FormError message={error} />
      {decision === null ? null : (
        <div aria-live="polite" className="space-y-2 border border-border p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Badge tone={decision.outcome === 'allow' ? 'accent' : 'danger'}>{outcomeLabel[decision.outcome]}</Badge>
            {decision.layers.length === 0 ? (
              <span className="text-sm font-normal text-muted-foreground">No policies apply.</span>
            ) : null}
          </p>
          <ul className="space-y-1 text-sm">
            {decision.reasons.map((reason) => (
              <li key={`${reason.code}:${reason.ruleId ?? ''}:${reason.scopeId ?? ''}`}>
                <span className="font-mono text-muted-foreground">{reason.level ?? 'policy'}</span> {reason.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
