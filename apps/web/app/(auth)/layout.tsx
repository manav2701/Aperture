import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <Link href="/" className="font-mono text-sm uppercase tracking-widest text-accent">
        Aperture
      </Link>
      {children}
    </main>
  );
}
