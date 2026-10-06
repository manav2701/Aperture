'use client';

import { EditPencil, Refresh } from 'iconoir-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

const ENTRIES = [
  { who: 'research-agent', what: 'anthropic call', amount: '0.42' },
  { who: 'card 4021', what: 'software, MCC 5734', amount: '38.00' },
  { who: 'support-bot', what: 'sent for approval', amount: '180.00' },
  { who: 'x402', what: 'data.example.com', amount: '0.05' },
] as const;

const GENESIS = '0'.repeat(64);

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Each entry's hash covers the entry and the hash before it, so one edit breaks every link after it. */
async function chain(amounts: readonly string[]) {
  const hashes: string[] = [];
  let previous = GENESIS;
  for (const [i, entry] of ENTRIES.entries()) {
    previous = await sha256(previous + JSON.stringify({ ...entry, amount: amounts[i] }));
    hashes.push(previous);
  }
  return hashes;
}

const ORIGINAL = ENTRIES.map((entry) => entry.amount);

/** A real hash chain, computed in the browser with WebCrypto. Edit an entry and watch it break. */
export function AuditDemo() {
  const [amounts, setAmounts] = useState<string[]>(ORIGINAL);
  const [sealed, setSealed] = useState<string[] | null>(null);
  const [current, setCurrent] = useState<string[] | null>(null);

  useEffect(() => {
    void chain(ORIGINAL).then(setSealed);
  }, []);
  useEffect(() => {
    let stale = false;
    void chain(amounts).then((hashes) => {
      if (!stale) setCurrent(hashes);
    });
    return () => {
      stale = true;
    };
  }, [amounts]);

  const firstBad = sealed === null || current === null ? -1 : current.findIndex((hash, i) => hash !== sealed[i]);
  const edited = amounts.findIndex((amount, i) => amount !== ORIGINAL[i]);

  function tamper(index: number) {
    setAmounts((previous) => previous.map((amount, i) => (i === index ? (Number(amount) * 10).toFixed(2) : amount)));
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ENTRIES.map((entry, i) => {
          const broken = firstBad !== -1 && i >= firstBad;
          const hash = current?.[i]?.slice(0, 10) ?? '··········';
          return (
            <li
              key={entry.who}
              className={cn(
                'relative flex flex-col gap-1.5 border p-2.5 font-mono text-[11px] transition-colors duration-300',
                broken ? 'border-danger bg-danger/5' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">#{i + 1}</span>
                <button
                  type="button"
                  onClick={() => {
                    tamper(i);
                  }}
                  aria-label={`Edit entry ${String(i + 1)} after the fact`}
                  className="-m-1.5 inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  <EditPencil aria-hidden="true" className="size-3.5" />
                </button>
              </div>
              <span className="truncate text-foreground">{entry.who}</span>
              <span className="truncate text-muted-foreground">{entry.what}</span>
              <span className={cn('tabular-nums', i === edited ? 'text-danger' : 'text-foreground')}>
                ${amounts[i]}
              </span>
              <span className={cn('truncate', broken ? 'text-danger' : 'text-highlight')}>{hash}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3 font-mono text-xs">
        <p aria-live="polite" className={firstBad === -1 ? 'text-muted-foreground' : 'text-danger'}>
          {firstBad === -1
            ? `verified · ${String(ENTRIES.length)} entries · sha-256`
            : `chain broken at #${String(firstBad + 1)}: hash no longer matches`}
        </p>
        {edited === -1 ? null : (
          <button
            type="button"
            onClick={() => {
              setAmounts(ORIGINAL);
            }}
            className="inline-flex h-8 items-center gap-1.5 border border-border px-2.5 hover:bg-muted"
          >
            <Refresh aria-hidden="true" className="size-3.5" />
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
