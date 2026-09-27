'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

const split = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

export function StripeConnectForm({ orgId, reconnect }: { orgId: string; reconnect: boolean }) {
  const { submit, pending, error } = useSubmit();
  const [open, setOpen] = useState(!reconnect);
  const [form, setForm] = useState({
    apiKey: '',
    authorizationSecret: '',
    eventsSecret: '',
    name: '',
    line1: '',
    city: '',
    postalCode: '',
    country: 'US',
    state: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm({ ...form, [key]: event.target.value });
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Replace the connection
      </Button>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            api.PUT('/api/v1/orgs/{orgId}/cards/stripe', {
              params: { path: { orgId } },
              body: {
                apiKey: form.apiKey,
                authorizationSecret: form.authorizationSecret,
                eventsSecret: form.eventsSecret,
                company: {
                  name: form.name,
                  line1: form.line1,
                  city: form.city,
                  postalCode: form.postalCode,
                  country: form.country.toUpperCase(),
                  ...(form.state === '' ? {} : { state: form.state }),
                },
              },
            }),
          () => {
            setOpen(false);
          },
        );
      }}
    >
      <Field label="Restricted key" htmlFor="stripe-key">
        <Input
          id="stripe-key"
          required
          placeholder="rk_test_…"
          autoComplete="off"
          value={form.apiKey}
          onChange={set('apiKey')}
        />
      </Field>
      <Field label="Authorization webhook secret" htmlFor="stripe-auth">
        <Input
          id="stripe-auth"
          required
          placeholder="whsec_…"
          autoComplete="off"
          value={form.authorizationSecret}
          onChange={set('authorizationSecret')}
        />
      </Field>
      <Field label="Events webhook secret" htmlFor="stripe-events">
        <Input
          id="stripe-events"
          required
          placeholder="whsec_…"
          autoComplete="off"
          value={form.eventsSecret}
          onChange={set('eventsSecret')}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Company cardholder (Stripe needs a billing address). Save first to get the webhook URLs, then paste their
        secrets with “Replace the connection”.
      </p>
      <Input aria-label="Company name" placeholder="Company name" required value={form.name} onChange={set('name')} />
      <Input aria-label="Street" placeholder="Street" required value={form.line1} onChange={set('line1')} />
      <div className="grid grid-cols-2 gap-2">
        <Input aria-label="City" placeholder="City" required value={form.city} onChange={set('city')} />
        <Input
          aria-label="Postal code"
          placeholder="Postal code"
          required
          value={form.postalCode}
          onChange={set('postalCode')}
        />
        <Input
          aria-label="Country"
          placeholder="US"
          required
          maxLength={2}
          value={form.country}
          onChange={set('country')}
        />
        <Input aria-label="State" placeholder="State (US)" value={form.state} onChange={set('state')} />
      </div>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Connect Stripe Issuing
      </Button>
    </form>
  );
}

export function IssueCardForm({ orgId, agents }: { orgId: string; agents: { id: string; name: string }[] }) {
  const { submit, pending, error } = useSubmit();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [purpose, setPurpose] = useState('');
  const [monthly, setMonthly] = useState('');
  const [perAuthorization, setPerAuthorization] = useState('');
  const [categories, setCategories] = useState('');
  const [countries, setCountries] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            api.POST('/api/v1/orgs/{orgId}/agents/{principalId}/cards', {
              params: { path: { orgId, principalId: agentId } },
              body: {
                purpose,
                ...(monthly === '' ? {} : { monthly }),
                ...(perAuthorization === '' ? {} : { perAuthorization }),
                ...(split(categories).length === 0 ? {} : { categories: split(categories) }),
                ...(split(countries).length === 0 ? {} : { countries: split(countries).map((c) => c.toUpperCase()) }),
              },
            }),
          () => {
            setPurpose('');
          },
        );
      }}
    >
      <Field label="Agent" htmlFor="card-agent">
        <Select
          id="card-agent"
          value={agentId}
          onChange={(e) => {
            setAgentId(e.target.value);
          }}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Purpose" htmlFor="card-purpose">
        <Input
          id="card-purpose"
          required
          value={purpose}
          onChange={(e) => {
            setPurpose(e.target.value);
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Per purchase (USD)" htmlFor="card-per">
          <Input
            id="card-per"
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            value={perAuthorization}
            onChange={(e) => {
              setPerAuthorization(e.target.value);
            }}
          />
        </Field>
        <Field label="Monthly (USD)" htmlFor="card-monthly">
          <Input
            id="card-monthly"
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            value={monthly}
            onChange={(e) => {
              setMonthly(e.target.value);
            }}
          />
        </Field>
      </div>
      <Field
        label="Merchant categories"
        htmlFor="card-categories"
        hint="Stripe category names, comma separated, e.g. computer_software_stores. Empty: any (policies still apply)."
      >
        <Input
          id="card-categories"
          value={categories}
          onChange={(e) => {
            setCategories(e.target.value);
          }}
        />
      </Field>
      <Field label="Countries" htmlFor="card-countries" hint="e.g. US, AE. Empty: any.">
        <Input
          id="card-countries"
          value={countries}
          onChange={(e) => {
            setCountries(e.target.value);
          }}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        These limits are also set on the card at Stripe as a backstop; Aperture’s budgets and policies decide each
        purchase.
      </p>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || agentId === ''}>
        Issue virtual card
      </Button>
    </form>
  );
}

export function CardStatusActions({
  orgId,
  cardId,
  status,
}: {
  orgId: string;
  cardId: string;
  status: 'active' | 'inactive' | 'canceled';
}) {
  const { submit, pending, error } = useSubmit();
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (status === 'canceled') return null;
  const setStatus = (next: 'active' | 'inactive' | 'canceled') => {
    submit(() =>
      api.POST('/api/v1/orgs/{orgId}/cards/{cardId}/status', {
        params: { path: { orgId, cardId } },
        body: { status: next },
      }),
    );
  };
  return (
    <span className="flex items-center gap-2">
      <FormError message={error} />
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setStatus(status === 'active' ? 'inactive' : 'active');
        }}
      >
        {status === 'active' ? 'Freeze' : 'Unfreeze'}
      </Button>
      {confirmCancel ? (
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => {
            setStatus('canceled');
          }}
        >
          Confirm cancel
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setConfirmCancel(true);
          }}
        >
          Cancel
        </Button>
      )}
    </span>
  );
}
