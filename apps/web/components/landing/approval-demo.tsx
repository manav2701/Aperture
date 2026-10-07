'use client';

import { Check, Refresh, Xmark } from 'iconoir-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

type State = 'pending' | 'approved' | 'denied';

/** An approval request as a reviewer sees it. Decide, then replay. */
export function ApprovalDemo() {
  const [state, setState] = useState<State>('pending');

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="border border-border bg-background p-4">
        <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
          <span>#finance-approvals</span>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('size-1.5', state === 'pending' ? 'cursor-blink bg-accent' : 'bg-border')} />
            {state === 'pending' ? 'waiting' : 'closed'}
          </span>
        </div>
        <p className="mt-4 text-sm leading-relaxed">
          <span className="font-semibold">support-bot</span> wants to spend{' '}
          <span className="font-semibold tabular-nums">$180.00</span> on a long anthropic run.
        </p>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">rule big-spend · above $100.00</p>
      </div>

      <div className="mt-auto" aria-live="polite">
        {state === 'pending' ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setState('approved');
              }}
              className="inline-flex h-10 items-center justify-center gap-1.5 bg-accent text-sm font-medium text-accent-foreground transition-transform active:scale-[0.97]"
            >
              <Check aria-hidden="true" className="size-4" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => {
                setState('denied');
              }}
              className="inline-flex h-10 items-center justify-center gap-1.5 border border-border text-sm transition-transform hover:bg-muted active:scale-[0.97]"
            >
              <Xmark aria-hidden="true" className="size-4" />
              Deny
            </button>
          </div>
        ) : (
          <div className="flex h-10 items-center justify-between border border-border px-3 font-mono text-xs">
            <span className={state === 'approved' ? 'text-highlight' : 'text-danger'}>
              {state === 'approved' ? 'approved by you · request released' : 'denied by you · hold returned'}
            </span>
            <button
              type="button"
              onClick={() => {
                setState('pending');
              }}
              aria-label="Replay"
              className="-mr-2 inline-flex size-8 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <Refresh aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
