import type { Metadata } from 'next';
import Link from 'next/link';
import { safeNext } from '@/lib/auth-client';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Create an account — Aperture' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Create an account</h1>
        <p className="text-sm text-muted-foreground">
          Already have one?{' '}
          <Link
            className="text-accent underline-offset-4 hover:underline"
            href={`/login?next=${encodeURIComponent(next)}`}
          >
            Sign in
          </Link>
        </p>
      </div>
      <SignupForm next={next} initialEmail={params.email ?? ''} />
    </>
  );
}
