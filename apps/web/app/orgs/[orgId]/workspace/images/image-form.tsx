'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Select, Textarea } from '@/components/ui/form';
import { CostPreview, useCostPreview } from '../cost-preview';

const PREFERRED = ['bytedance-seed/seedream-5-0-lite', 'google/gemini-3.1-flash-lite-image', 'openai/gpt-image-1-mini'];

export function ImageForm({ orgId, models }: { orgId: string; models: { model: string; price: string }[] }) {
  const router = useRouter();
  const [model, setModel] = useState(
    PREFERRED.find((id) => models.some((m) => m.model === id)) ?? models[0]?.model ?? '',
  );
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = useCostPreview(orgId, model === '' ? null : { type: 'image', model, n: count });

  const generate = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/v1/orgs/${orgId}/workspace/images`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, n: count }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(body.error?.message ?? 'The images could not be generated.');
        return;
      }
      setPrompt('');
      router.refresh();
    });
  };

  return (
    <form onSubmit={generate} className="space-y-4">
      <Field label="Model" htmlFor="image-model" hint={models.find((m) => m.model === model)?.price}>
        <Select
          id="image-model"
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
      <Field label="Prompt" htmlFor="image-prompt">
        <Textarea
          id="image-prompt"
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
      <Field label="How many" htmlFor="image-count">
        <Select
          id="image-count"
          value={count}
          onChange={(e) => {
            setCount(Number(e.target.value));
          }}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <CostPreview preview={preview} />
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || preview?.allowed === false || prompt.trim() === ''}>
        {pending ? 'Generating…' : 'Generate'}
      </Button>
    </form>
  );
}
