'use client';

import { useState, type SubmitEvent } from 'react';
import { TimezoneSelect } from '@/components/timezone-select';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import type { Org } from '@/lib/api/types';
import { useSubmit } from '@/lib/use-submit';

export function OrgForm({ org, canEdit }: { org: Org; canEdit: boolean }) {
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  const { submit, pending, error } = useSubmit();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submit(() =>
      api.PATCH('/api/v1/orgs/{orgId}', {
        params: { path: { orgId: org.id } },
        body: { name, ...(timezone === org.timezone ? {} : { timezone }) },
      }),
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Name" htmlFor="org-name">
        <Input
          id="org-name"
          required
          maxLength={100}
          disabled={!canEdit}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="Time zone" htmlFor="org-timezone" hint="Locked once any spend has been recorded.">
        <TimezoneSelect id="org-timezone" value={timezone} onChange={setTimezone} disabled={!canEdit} />
      </Field>
      <FormError message={error} />
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      ) : null}
    </form>
  );
}
