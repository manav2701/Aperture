'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

/** Values match the team_size check in the database; the labels are only ever shown here. */
const TEAM_SIZES = [
  { value: 'just_me', label: 'Just me' },
  { value: '2_10', label: '2–10 people' },
  { value: '11_50', label: '11–50 people' },
  { value: '51_200', label: '51–200 people' },
  { value: '200_plus', label: 'More than 200 people' },
] as const;

type TeamSize = (typeof TEAM_SIZES)[number]['value'];

export function WaitlistForm({ referrer }: { referrer: string | undefined }) {
  const { submit, pending, error } = useSubmit();
  const [done, setDone] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [teamSize, setTeamSize] = useState<TeamSize | ''>('');
  const [note, setNote] = useState('');

  if (done) {
    return (
      <FormNotice>
        You are on the list. We onboard the first teams by hand, so expect a note from a person rather than an automatic
        email.
      </FormNotice>
    );
  }

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submit(
      () =>
        api.POST('/api/v1/public/waitlist', {
          body: {
            name,
            email,
            ...(company === '' ? {} : { company }),
            ...(teamSize === '' ? {} : { teamSize }),
            ...(note === '' ? {} : { note }),
            ...(referrer === undefined ? {} : { referrer }),
          },
        }),
      () => {
        setDone(true);
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Your name" htmlFor="name">
        <Input
          id="name"
          autoComplete="name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="Work email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </Field>
      <Field label="Company" htmlFor="company" hint="Optional.">
        <Input
          id="company"
          autoComplete="organization"
          maxLength={120}
          value={company}
          onChange={(e) => {
            setCompany(e.target.value);
          }}
        />
      </Field>
      <Field label="How many people use AI at work?" htmlFor="teamSize">
        <Select
          id="teamSize"
          value={teamSize}
          onChange={(e) => {
            setTeamSize(e.target.value as TeamSize | '');
          }}
        >
          <option value="">Prefer not to say</option>
          {TEAM_SIZES.map((size) => (
            <option key={size.value} value={size.value}>
              {size.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="What are you trying to get a handle on?"
        htmlFor="note"
        hint="Optional, and the part we read first."
      >
        <Textarea
          id="note"
          rows={4}
          maxLength={1000}
          placeholder="Six teams on three OpenAI accounts and nobody owns the bill."
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Request access
      </Button>
    </form>
  );
}
