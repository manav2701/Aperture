'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function RetentionForm({
  orgId,
  requestLogDays,
  mediaDays,
}: {
  orgId: string;
  requestLogDays: number;
  mediaDays: number;
}) {
  const { submit, pending, error } = useSubmit();
  const [requests, setRequests] = useState(String(requestLogDays));
  const [media, setMedia] = useState(String(mediaDays));
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(() =>
          api.PUT('/api/v1/orgs/{orgId}/settings/privacy', {
            params: { path: { orgId } },
            body: { requestLogDays: Number(requests), mediaDays: Number(media) },
          }),
        );
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Request logs (days)" htmlFor="ret-requests" hint="7–3650">
          <Input
            id="ret-requests"
            type="number"
            min={7}
            max={3650}
            value={requests}
            onChange={(e) => {
              setRequests(e.target.value);
            }}
          />
        </Field>
        <Field label="Media (days)" htmlFor="ret-media" hint="1–3650">
          <Input
            id="ret-media"
            type="number"
            min={1}
            max={3650}
            value={media}
            onChange={(e) => {
              setMedia(e.target.value);
            }}
          />
        </Field>
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export function ExportButton({ orgId }: { orgId: string }) {
  return (
    <a
      href={`/api/v1/orgs/${orgId}/export`}
      className="inline-flex h-9 items-center border border-border px-4 text-sm hover:border-accent"
      download
    >
      Download export (JSON)
    </a>
  );
}

export function DeletionForm({
  orgId,
  orgName,
  pending: requested,
}: {
  orgId: string;
  orgName: string;
  pending: boolean;
}) {
  const { submit, pending, error } = useSubmit();
  const [name, setName] = useState('');
  if (requested) {
    return (
      <div className="space-y-2">
        <FormError message={error} />
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            submit(() => api.DELETE('/api/v1/orgs/{orgId}/deletion', { params: { path: { orgId } } }));
          }}
        >
          Cancel deletion
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(() =>
          api.POST('/api/v1/orgs/{orgId}/deletion', { params: { path: { orgId } }, body: { confirmName: name } }),
        );
      }}
    >
      <Field label={`Type “${orgName}” to confirm`} htmlFor="delete-name">
        <Input
          id="delete-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" variant="danger" disabled={pending || name !== orgName}>
        Request deletion
      </Button>
    </form>
  );
}
