'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { TimezoneSelect } from '@/components/timezone-select';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Dubai');
  // Default to the browser's zone; read after mount so server and client render the same markup.
  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  const { submit, pending, error } = useSubmit();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    let orgId: string | undefined;
    submit(
      async () => {
        const result = await api.POST('/api/v1/orgs', { body: { name, timezone } });
        orgId = result.data?.id;
        return result;
      },
      () => {
        if (orgId !== undefined) router.push(`/orgs/${orgId}`);
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Organization name" htmlFor="name">
        <Input
          id="name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field
        label="Time zone"
        htmlFor="timezone"
        hint="Budget days and months start at midnight here. It can't change once spending is recorded."
      >
        <TimezoneSelect id="timezone" value={timezone} onChange={setTimezone} />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Create organization
      </Button>
    </form>
  );
}
