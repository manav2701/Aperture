'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function NewTeam({ orgId }: { orgId: string }) {
  const [name, setName] = useState('');
  const { submit, pending, error } = useSubmit();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submit(
      () => api.POST('/api/v1/orgs/{orgId}/teams', { params: { path: { orgId } }, body: { name } }),
      () => {
        setName('');
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Name" htmlFor="team-name">
        <Input
          id="team-name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Create team
      </Button>
    </form>
  );
}
