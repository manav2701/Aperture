import {
  ArrowRight,
  Bank,
  Check,
  Coins,
  EyeClosed,
  Fingerprint,
  Group,
  Hashtag,
  Lock,
  ShieldCheck,
} from 'iconoir-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApprovalDemo } from '@/components/landing/approval-demo';
import { AuditDemo } from '@/components/landing/audit-demo';
import { BudgetSkyline } from '@/components/landing/budget-skyline';
import { AgentsDemo, BudgetDemo, BudgetStack, FeatureCard, RailsDemo } from '@/components/landing/cards';
import { PolicyDemo } from '@/components/landing/policy-demo';
import { SpotlightGrid } from '@/components/landing/spotlight-grid';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

const RAILS = [
  'OpenAI',
  'Anthropic',
  'Google',
  'OpenRouter',
  'Hugging Face',
  'Image and video models',
  'Your card program',
  'USDC on Solana (x402)',
];

const SAFEGUARDS = [
  {
    icon: <Bank aria-hidden="true" className="size-5" />,
    title: 'We never hold your money',
    body: 'Aperture enforces through your own provider accounts, card program and wallets. No funds or card numbers sit with us.',
  },
  {
    icon: <Hashtag aria-hidden="true" className="size-5" />,
    title: 'A log you can check yourself',
    body: 'Every decision is hash-chained. Export it and verify the whole history offline with one command.',
  },
  {
    icon: <Fingerprint aria-hidden="true" className="size-5" />,
    title: 'Two-factor for anyone near money',
    body: 'Owners, admins and finance roles must turn on two-factor before they can change a thing.',
  },
  {
    icon: <EyeClosed aria-hidden="true" className="size-5" />,
    title: 'You choose what gets logged',
    body: 'Keep full prompts, metadata only, or nothing at all. Set it per policy.',
  },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
      <span className="size-1.5 bg-accent" />
      {children}
    </p>
  );
}

export default function HomePage() {
  return (
    <div className="overflow-x-clip">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-md">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6">
          <Logo />
          <ul className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <li>
              <a href="#product" className="hover:text-foreground">
                Product
              </a>
            </li>
            <li>
              <a href="#budgets" className="hover:text-foreground">
                Budgets
              </a>
            </li>
            <li>
              <a href="#security" className="hover:text-foreground">
                Security
              </a>
            </li>
          </ul>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className="hidden h-9 items-center px-3 text-sm hover:bg-muted sm:inline-flex">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center gap-1.5 bg-accent px-3.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="relative">
          <div className="bg-grid pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-6 px-4 pb-12 pt-14 sm:px-6 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1.15fr_1fr] lg:pt-6">
            <div className="space-y-8">
              <p className="fade-up flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <span className="cursor-blink size-2 bg-accent" />
                Spend control for AI
              </p>
              <h1 className="text-[clamp(2.6rem,5.6vw,4.5rem)] font-bold leading-[0.95] tracking-[-0.035em]">
                <span className="rise-line">
                  <span>Give agents a budget.</span>
                </span>
                <span className="rise-line">
                  <span className="text-muted-foreground">Not a blank check.</span>
                </span>
              </h1>
              <p className="fade-up max-w-xl text-lg text-muted-foreground text-pretty">
                Aperture checks every AI charge before it lands: model calls, card swipes, stablecoin payments. One set
                of rules, one budget, one log nobody can quietly edit.
              </p>
              <div className="fade-up flex flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="group inline-flex h-12 items-center gap-2 bg-accent px-6 font-medium text-accent-foreground hover:bg-accent/90"
                >
                  Get started
                  <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="#product" className="inline-flex h-12 items-center border border-border px-6 hover:bg-muted">
                  See it work
                </a>
              </div>
            </div>

            <div>
              <BudgetSkyline className="mx-auto max-w-[680px]" />
              <p className="mt-2 flex flex-wrap justify-end gap-x-5 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 bg-accent" /> spent
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rotate-45 border border-foreground" /> ceiling
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 bg-danger" /> at ceiling, requests held
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* Rails ticker */}
        <section aria-label="Supported rails" className="border-y border-border">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 sm:px-6">
            <p className="hidden shrink-0 py-5 font-mono text-xs uppercase tracking-wider text-muted-foreground sm:block">
              One policy across
            </p>
            <div className="marquee-mask flex-1 overflow-hidden py-5">
              <ul className="marquee flex w-max gap-10 text-sm font-medium">
                {[...RAILS, ...RAILS].map((rail, i) => (
                  <li
                    key={`${rail}-${String(i)}`}
                    aria-hidden={i >= RAILS.length}
                    className="flex items-center gap-10 whitespace-nowrap"
                  >
                    {rail}
                    <span className="size-1 bg-border" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Product */}
        <section id="product" className="mx-auto max-w-7xl scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32">
          <div className="reveal mb-16 flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl space-y-4">
              <Eyebrow>Product</Eyebrow>
              <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">Rules up front. Receipts after.</h2>
            </div>
            <p className="max-w-sm text-muted-foreground">
              Go ahead and poke at these. They run the same logic the product does.
            </p>
          </div>

          <SpotlightGrid className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3 lg:gap-8">
            <FeatureCard
              className="reveal lg:col-span-2"
              icon={<Lock aria-hidden="true" className="size-4" />}
              title="Policies"
              line="Write a rule once. It holds on every rail."
            >
              <PolicyDemo />
            </FeatureCard>
            <FeatureCard
              className="reveal"
              icon={<Check aria-hidden="true" className="size-4" />}
              title="Approvals"
              line="Big spends wait for a human. Everything else just runs."
            >
              <ApprovalDemo />
            </FeatureCard>
            <FeatureCard
              className="reveal"
              icon={<Coins aria-hidden="true" className="size-4" />}
              title="Budgets"
              line="Money is held before the call, not argued over after the invoice."
            >
              <BudgetDemo />
            </FeatureCard>
            <FeatureCard
              className="reveal lg:col-span-2"
              icon={<Hashtag aria-hidden="true" className="size-4" />}
              title="Audit log"
              line="Every decision is hash-chained. Edit one and the chain tells on you."
            >
              <AuditDemo />
            </FeatureCard>
            <FeatureCard
              className="reveal"
              icon={<Group aria-hidden="true" className="size-4" />}
              title="Agents and keys"
              line="Each agent gets its own key, its own cap, and nothing more."
            >
              <AgentsDemo />
            </FeatureCard>
            <FeatureCard
              className="reveal lg:col-span-2"
              icon={<ShieldCheck aria-hidden="true" className="size-4" />}
              title="Rails"
              line="Cards and stablecoins answer to the same rules as your model calls."
            >
              <RailsDemo />
            </FeatureCard>
          </SpotlightGrid>
        </section>

        {/* Budget stack */}
        <section id="budgets" className="scroll-mt-16 border-y border-border">
          <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div className="reveal max-w-lg space-y-5">
              <Eyebrow>Budgets</Eyebrow>
              <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">Budgets nest the way your company does.</h2>
              <p className="text-lg text-muted-foreground">
                Set one number for the org. Split it by team, then by agent. A request goes through only if it fits
                every level above it.
              </p>
            </div>
            <BudgetStack />
          </div>
        </section>

        {/* Security */}
        <section id="security" className="mx-auto max-w-7xl scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32">
          <div className="reveal mb-12 max-w-2xl space-y-4">
            <Eyebrow>Security</Eyebrow>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">Built for the people who sign off.</h2>
          </div>
          <ul className="grid border-l border-t border-border sm:grid-cols-2 lg:grid-cols-4">
            {SAFEGUARDS.map((item) => (
              <li key={item.title} className="reveal space-y-3 border-b border-r border-border p-6">
                <span className="inline-flex size-10 items-center justify-center border border-border text-highlight">
                  {item.icon}
                </span>
                <h3 className="font-semibold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Closing call to action */}
        <section className="relative overflow-hidden border-t border-border">
          <div className="bg-grid pointer-events-none absolute inset-0" />
          <div className="reveal relative mx-auto flex max-w-7xl flex-col items-start gap-8 px-4 py-24 sm:px-6 sm:py-32 lg:flex-row lg:items-end lg:justify-between">
            <h2 className="text-[clamp(2.75rem,7vw,6rem)] font-bold leading-[0.92] tracking-[-0.04em]">
              Put a ceiling
              <br />
              on it<span className="text-highlight">.</span>
            </h2>
            <div className="max-w-sm space-y-6">
              <p className="text-muted-foreground">
                Connect a provider, set a budget, and watch the first request get checked.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="group inline-flex h-12 items-center gap-2 bg-accent px-6 font-medium text-accent-foreground hover:bg-accent/90"
                >
                  Get started
                  <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link href="/login" className="inline-flex h-12 items-center border border-border px-6 hover:bg-muted">
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6">
          <Logo />
          <p className="font-mono text-xs">© {new Date().getFullYear()} Aperture. Governance for AI spend.</p>
        </div>
      </footer>
    </div>
  );
}
