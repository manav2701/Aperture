import type { Metadata } from 'next';
import { safeNext } from '@/lib/auth-client';
import { TwoFactorForm } from './two-factor-form';

export const metadata: Metadata = { title: 'Two-factor — Aperture' };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Two-factor code</h1>
        <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <TwoFactorForm next={next} />
    </>
  );
}
