'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Select, Textarea } from '@/components/ui/form';
import { CostPreview, useCostPreview } from '../cost-preview';

const PREFERRED = ['google/veo-3.1-lite', 'x-ai/grok-imagine-video', 'alibaba/wan-3.0'];

export function VideoForm({ orgId, models }: { orgId: string; models: { model: string; perSecond: string }[] }) {
  const router = useRouter();
  const [model, setModel] = useState(
    PREFERRED.find((id) => models.some((m) => m.model === id)) ?? models[0]?.model ?? '',
  );
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(4);
  const [resolution, setResolution] = useState('720p');
  const [audio, setAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const request = { type: 'video', model, seconds, resolution, audio };
  const preview = useCostPreview(orgId, model === '' ? null : request);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/v1/orgs/${orgId}/workspace/videos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, seconds, resolution, audio }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(body.error?.message ?? 'The video could not be started.');
        return;
      }
      setPrompt('');
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field
        label="Model"
        htmlFor="video-model"
        hint={`Up to $${models.find((m) => m.model === model)?.perSecond ?? '?'} per second`}
      >
        <Select
          id="video-model"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
          }}
        >
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Prompt" htmlFor="video-prompt">
        <Textarea
          id="video-prompt"
          rows={4}
          required
          maxLength={8000}
          className="font-sans"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Seconds" htmlFor="video-seconds">
          <Select
            id="video-seconds"
            value={seconds}
            onChange={(e) => {
              setSeconds(Number(e.target.value));
            }}
          >
            {[4, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Resolution" htmlFor="video-resolution">
          <Select
            id="video-resolution"
            value={resolution}
            onChange={(e) => {
              setResolution(e.target.value);
            }}
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={audio}
          onChange={(e) => {
            setAudio(e.target.checked);
          }}
        />
        With audio (costs more on most models)
      </label>
      <CostPreview preview={preview} />
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || preview?.allowed === false || prompt.trim() === ''}>
        {pending ? 'Submitting…' : 'Generate video'}
      </Button>
    </form>
  );
}
