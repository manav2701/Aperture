import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Check your email — Aperture' };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Check your email</h1>
      <p className="text-muted-foreground">
        We sent a verification link to{' '}
        {email === undefined ? 'your inbox' : <strong className="text-foreground">{email}</strong>}. Open it on this
        device to finish signing up.
      </p>
      <p className="text-sm text-muted-foreground">
        Nothing arrived? Check spam, or{' '}
        <Link href="/login" className="text-accent underline-offset-4 hover:underline">
          sign in
        </Link>{' '}
        to get a new link.
      </p>
    </div>
  );
}
