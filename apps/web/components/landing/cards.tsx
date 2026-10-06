import { Coins, Cpu, CreditCard } from 'iconoir-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A feature card: what it is, one line on why it matters, and a small working demo. */
export function FeatureCard({
  icon,
  title,
  line,
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  line: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={cn(
        'spotlight flex min-w-0 flex-col gap-5 border border-border bg-background p-5 hover:border-foreground/30 sm:p-6',
        className,
      )}
    >
      <header className="space-y-2">
        <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          <span className="text-highlight">{icon}</span>
          {title}
        </p>
        <h3 className="text-lg font-semibold leading-snug text-balance">{line}</h3>
      </header>
      <div className="relative flex-1">{children}</div>
    </article>
  );
}

/** Budget: a hold is placed before the call, then settles at the real cost. */
export function BudgetDemo() {
  return (
    <div className="flex h-full flex-col justify-end gap-3 font-mono text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">research team · june</span>
        <span className="tabular-nums">$3,680 / $8,000</span>
      </div>
      <div className="flex h-3 bg-muted">
        <div className="h-full w-[46%] bg-accent" />
        <div className="hold-bar h-full w-[6%]">
          <div className="hold-stripes h-full w-full" />
        </div>
      </div>
      <div className="relative h-4 text-muted-foreground">
        <span className="label-hold absolute inset-0">hold $2.40 · claude call in flight</span>
        <span className="label-settled absolute inset-0 text-highlight">settled $1.87 · $0.53 released</span>
      </div>
    </div>
  );
}

const AGENTS = [
  { name: 'support-bot', key: 'apk_…7Qz2', used: 62, cap: 100 },
  { name: 'research-agent', key: 'apk_…m4Ka', used: 18, cap: 50 },
  { name: 'nightly-evals', key: 'apk_…Xe90', used: 108, cap: 120 },
];

/** Agents: one key and one daily cap each. */
export function AgentsDemo() {
  return (
    <ul className="flex h-full flex-col justify-end gap-3 font-mono text-xs">
      {AGENTS.map((agent) => (
        <li key={agent.name} className="space-y-1.5">
          <div className="flex justify-between gap-2">
            <span className="truncate">{agent.name}</span>
            <span className="shrink-0 text-muted-foreground">{agent.key}</span>
          </div>
          <meter
            min={0}
            max={agent.cap}
            low={agent.cap * 0.75}
            high={agent.cap * 0.85}
            optimum={0}
            value={agent.used}
            aria-label={`${agent.name}: $${String(agent.used)} of $${String(agent.cap)} today`}
          />
          <p className="text-right tabular-nums text-muted-foreground">
            ${agent.used} of ${agent.cap} today
          </p>
        </li>
      ))}
    </ul>
  );
}

const RAILS = [
  {
    icon: <Cpu aria-hidden="true" className="size-4" />,
    rail: 'Model call',
    detail: 'openai · gpt-5',
    amount: '$0.31',
  },
  {
    icon: <CreditCard aria-hidden="true" className="size-4" />,
    rail: 'Card swipe',
    detail: 'MCC 5734 · software',
    amount: '$49.00',
  },
  {
    icon: <Coins aria-hidden="true" className="size-4" />,
    rail: 'x402 payment',
    detail: 'USDC on Solana',
    amount: '$0.05',
  },
];

/** Rails: three kinds of spend, checked one after another by the same policy. */
export function RailsDemo() {
  return (
    <ul className="flex h-full flex-col justify-end gap-2">
      {RAILS.map((row) => (
        <li
          key={row.rail}
          className="rail-row flex items-center gap-3 border border-border px-3 py-2.5 font-mono text-xs"
        >
          <span className="text-highlight">{row.icon}</span>
          <span className="w-24 shrink-0 text-foreground">{row.rail}</span>
          <span className="truncate text-muted-foreground">{row.detail}</span>
          <span className="ml-auto tabular-nums">{row.amount}</span>
          <span className="hidden text-highlight sm:inline">checked</span>
        </li>
      ))}
    </ul>
  );
}

const PLATES = [
  {
    level: 'org',
    name: 'Acme',
    amount: '$50,000 / mo',
    size: 'size-72',
    depth: '[--i:0]',
    tone: 'bg-background shadow-[6px_6px_0_0_var(--muted)]',
  },
  {
    level: 'team',
    name: 'Research',
    amount: '$8,000 / mo',
    size: 'size-56',
    depth: '[--i:1]',
    tone: 'bg-background shadow-[6px_6px_0_0_var(--muted)]',
  },
  {
    level: 'agent',
    name: 'research-agent',
    amount: '$400 / mo',
    size: 'size-40',
    depth: '[--i:2]',
    tone: 'bg-background shadow-[6px_6px_0_0_var(--muted)]',
  },
  {
    level: 'request',
    name: 'claude call',
    amount: '$0.42',
    size: 'size-24',
    depth: '[--i:3]',
    tone: 'bg-accent text-accent-foreground shadow-[6px_6px_0_0_color-mix(in_oklab,var(--accent)_55%,black)]',
  },
];

/** Org, team, agent, request: isometric plates that spread apart as the section scrolls into view. */
export function BudgetStack() {
  return (
    <div
      className="relative flex h-[420px] items-center justify-center overflow-hidden sm:h-[480px]"
      aria-hidden="true"
    >
      <div className="iso-scene grid translate-y-10 place-items-center">
        {PLATES.map((plate) => (
          <div
            key={plate.level}
            className={cn(
              'iso-plate col-start-1 row-start-1 flex flex-col justify-between border border-foreground/25 p-3',
              plate.size,
              plate.depth,
              plate.tone,
            )}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">{plate.level}</span>
            <span className="space-y-0.5">
              <span className="block text-sm font-semibold leading-tight">{plate.name}</span>
              <span className="block font-mono text-[11px] tabular-nums opacity-80">{plate.amount}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
