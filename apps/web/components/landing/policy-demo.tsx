'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/cn';

const PROVIDERS = ['openai', 'anthropic', 'runway'] as const;
type Provider = (typeof PROVIDERS)[number];

/** The example policy, as the rule engine stores it. Each line is one rule. */
const RULES = [
  { id: 'providers', text: '{ "type": "allow_providers", "providers": ["openai", "anthropic"] }' },
  { id: 'big-spend', text: '{ "type": "approval_threshold", "above": "100.00" }' },
  { id: 'per-action', text: '{ "type": "max_amount_per_action", "max": "250.00" }' },
] as const;

interface Decision {
  outcome: 'allow' | 'approval' | 'deny';
  rule: (typeof RULES)[number]['id'] | null;
}

/** Mirrors what the real engine decides for these three rules. */
function decide(provider: Provider, amount: number): Decision {
  if (provider === 'runway') return { outcome: 'deny', rule: 'providers' };
  if (amount > 250) return { outcome: 'deny', rule: 'per-action' };
  if (amount > 100) return { outcome: 'approval', rule: 'big-spend' };
  return { outcome: 'allow', rule: null };
}

const OUTCOME = {
  allow: { label: 'Allowed', className: 'border-accent bg-accent text-accent-foreground' },
  approval: { label: 'Needs approval', className: 'border-highlight text-highlight' },
  deny: { label: 'Blocked', className: 'border-danger text-danger' },
};

/** Pick a provider and drag the amount; the policy answers as you go. */
export function PolicyDemo() {
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [amount, setAmount] = useState(42);
  const amountId = useId();
  const decision = decide(provider, amount);
  const outcome = OUTCOME[decision.outcome];

  return (
    <div className="flex h-full flex-col gap-6">
      <pre className="overflow-x-auto border border-border bg-background p-4 font-mono text-[11px] leading-6 sm:text-xs">
        <span className="text-muted-foreground">{'// policy: research-team'}</span>
        {'\n'}
        {RULES.map((rule) => (
          <span
            key={rule.id}
            className={cn(
              'block px-1 transition-colors duration-300',
              decision.rule === rule.id ? 'bg-accent/15 text-foreground' : 'text-muted-foreground',
            )}
          >
            {rule.text}
          </span>
        ))}
      </pre>

      <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
        <fieldset className="space-y-3">
          <legend className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Provider</legend>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={provider === name}
                onClick={() => {
                  setProvider(name);
                }}
                className={cn(
                  'h-9 border px-3 font-mono text-xs transition-colors',
                  provider === name
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="space-y-3">
          <label htmlFor={amountId} className="flex justify-between font-mono text-xs uppercase tracking-wider">
            <span className="text-muted-foreground">Amount</span>
            <span className="tabular-nums">${amount.toFixed(2)}</span>
          </label>
          <input
            id={amountId}
            type="range"
            min={1}
            max={400}
            value={amount}
            onChange={(event) => {
              setAmount(Number(event.target.value));
            }}
            className="h-9 w-full cursor-pointer accent-accent"
          />
        </div>
      </div>

      <p
        className="mt-auto flex flex-wrap items-center gap-3 border-t border-border pt-5 font-mono text-xs"
        aria-live="polite"
      >
        <span className={cn('border px-2 py-1 font-semibold transition-colors duration-300', outcome.className)}>
          {outcome.label}
        </span>
        <span className="text-muted-foreground">
          {decision.rule === null ? 'every rule passed' : `rule "${decision.rule}" decided`}
        </span>
      </p>
    </div>
  );
}
