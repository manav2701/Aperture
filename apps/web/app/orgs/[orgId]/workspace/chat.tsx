'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormError, Input, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/cn';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_MODELS = [
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash-lite',
  'anthropic/claude-haiku-4.5',
  'meta-llama/llama-3.1-8b-instruct',
];

/** Reads an OpenAI-format SSE stream and reports each text delta. */
async function readStream(body: ReadableStream<Uint8Array>, onText: (text: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '' || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const text = parsed.choices?.[0]?.delta?.content;
          if (typeof text === 'string') onText(text);
        } catch {
          // Ignore keep-alives.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export function Chat({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [model, setModel] = useState(SUGGESTED_MODELS[0] ?? '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const send = async (event: SubmitEvent) => {
    event.preventDefault();
    if (draft.trim() === '' || pending) return;
    const history: Message[] = [...messages, { role: 'user', content: draft }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setDraft('');
    setError(null);
    setPending(true);
    abort.current = new AbortController();
    try {
      const response = await fetch(`/api/v1/orgs/${orgId}/workspace/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: history }),
        signal: abort.current.signal,
      });
      if (!response.ok || response.body === null) {
        const failure = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(failure.error?.message ?? 'The request was not allowed.');
        setMessages(history);
        return;
      }
      await readStream(response.body, (text) => {
        setMessages((current) => {
          const last = current.at(-1);
          if (last?.role !== 'assistant') return current;
          return [...current.slice(0, -1), { role: 'assistant', content: last.content + text }];
        });
      });
    } catch (failure) {
      if ((failure as Error).name !== 'AbortError')
        setError('The connection dropped. Anything already generated was still counted.');
    } finally {
      setPending(false);
      abort.current = null;
      // The budget line in the header comes from the server.
      router.refresh();
    }
  };

  return (
    <div className="flex min-h-[60vh] flex-col border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <label htmlFor="model" className="text-sm text-muted-foreground">
          Model
        </label>
        <Input
          id="model"
          list="suggested-models"
          className="h-8 max-w-xs font-mono text-sm"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
          }}
        />
        <datalist id="suggested-models">
          {SUGGESTED_MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      <ol aria-live="polite" className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <li className="text-sm text-muted-foreground">Ask anything. Every message counts against your budget.</li>
        ) : null}
        {messages.map((message, index) => (
          <li
            key={`${String(index)}-${message.role}`}
            className={cn(
              'max-w-[85%] whitespace-pre-wrap px-3 py-2 text-sm',
              message.role === 'user' ? 'ml-auto bg-muted' : 'border border-border',
            )}
          >
            {message.content === '' && pending ? '…' : message.content}
          </li>
        ))}
      </ol>
      <form onSubmit={(event) => void send(event)} className="space-y-2 border-t border-border p-3">
        <FormError message={error} />
        <Textarea
          aria-label="Message"
          rows={3}
          className="font-sans"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          {pending ? (
            <Button variant="secondary" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          ) : null}
          <Button type="submit" disabled={pending || draft.trim() === ''}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
