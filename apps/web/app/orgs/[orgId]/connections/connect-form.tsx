'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Provider } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

interface ProviderInfo {
  provider: Provider;
  name: string;
  secretLabel: string;
  secretUrl: string;
  steps: string[];
  configFields: { key: string; label: string; required: boolean }[];
}

export function ConnectForm({ orgId, providers }: { orgId: string; providers: ProviderInfo[] }) {
  const [provider, setProvider] = useState<Provider>(providers[0]?.provider ?? 'openrouter');
  const [secret, setSecret] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const { submit, pending, error } = useSubmit();
  const info = providers.find((p) => p.provider === provider);
  const multiline = provider === 'google';

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submit(
      () =>
        api.POST('/api/v1/orgs/{orgId}/connections', {
          params: { path: { orgId } },
          body: { provider, secret, config },
        }),
      () => {
        setSecret('');
        setConfig({});
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Provider" htmlFor="provider">
        <Select
          id="provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as Provider);
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
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {info.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
          <li>
            <a
              href={info.secretUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline-offset-4 hover:underline"
            >
              Open {info.name}
            </a>
          </li>
        </ol>
      )}
      <Field
        label={info?.secretLabel ?? 'Secret'}
        htmlFor="secret"
        hint="Stored encrypted. Aperture never shows it again."
      >
        {multiline ? (
          <Textarea
            id="secret"
            rows={5}
            required
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
            }}
          />
        ) : (
          <Input
            id="secret"
            type="password"
            required
            autoComplete="off"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
            }}
          />
        )}
      </Field>
      {info?.configFields.map((field) => (
        <Field key={field.key} label={field.label} htmlFor={`config-${field.key}`}>
          <Input
            id={`config-${field.key}`}
            required={field.required}
            value={config[field.key] ?? ''}
            onChange={(e) => {
              setConfig({ ...config, [field.key]: e.target.value });
            }}
          />
        </Field>
      ))}
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Testing the connection…' : 'Test and connect'}
      </Button>
    </form>
  );
}
