'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function SlackForm({ orgId }: { orgId: string }) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const { submit, pending, error } = useSubmit();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submit(
      () => api.PUT('/api/v1/orgs/{orgId}/alerts/slack', { params: { path: { orgId } }, body: { webhookUrl } }),
      () => {
        setWebhookUrl('');
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field
        label="Incoming webhook URL"
        htmlFor="slack-url"
        hint="Slack → Apps → Incoming Webhooks. Stored encrypted."
      >
        <Input
          id="slack-url"
          type="password"
          required
          placeholder="https://hooks.slack.com/services/…"
          value={webhookUrl}
          onChange={(e) => {
            setWebhookUrl(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        Save
      </Button>
    </form>
  );
}
