import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <div className="flex items-center justify-between">
        <Logo />
        <ThemeToggle />
      </div>
      {children}
    </main>
  );
}
