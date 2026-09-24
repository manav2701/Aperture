import Link from 'next/link';

const rails = [
  { name: 'AI providers', detail: 'OpenRouter, OpenAI, Anthropic, Google, Hugging Face, image and video models' },
  { name: 'Cards', detail: 'Real-time authorization on your own card program' },
  { name: 'Stablecoins', detail: 'x402 payments on Solana from accounts you own' },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-4">
        <p className="font-mono text-sm uppercase tracking-widest text-accent">Aperture</p>
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl">Governance for AI spend.</h1>
        <p className="text-lg text-muted-foreground">
          One place to decide who — a person or an AI agent — may spend how much, on what, and through which rail, with
          a tamper-evident record of every decision.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-3">
        {rails.map((rail) => (
          <li key={rail.name} className="border border-border p-4">
            <p className="font-semibold">{rail.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{rail.detail}</p>
          </li>
        ))}
      </ul>

      <div className="flex gap-3">
        <Link href="/signup" className="bg-accent px-5 py-2.5 font-medium text-accent-foreground hover:bg-accent/90">
          Get started
        </Link>
        <Link href="/login" className="border border-border px-5 py-2.5 hover:bg-muted">
          Sign in
        </Link>
      </div>
    </main>
  );
}
