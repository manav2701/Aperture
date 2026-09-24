import type { Metadata } from 'next';
import Link from 'next/link';
import { safeNext } from '@/lib/auth-client';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in — Aperture' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          New to Aperture?{' '}
          <Link
            className="text-accent underline-offset-4 hover:underline"
            href={`/signup?next=${encodeURIComponent(next)}`}
          >
            Create an account
          </Link>
        </p>
      </div>
      <LoginForm next={next} />
    </>
  );
}
