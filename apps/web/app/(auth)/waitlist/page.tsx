import type { Metadata } from 'next';
import Link from 'next/link';
import { WaitlistForm } from './waitlist-form';

export const metadata: Metadata = {
  title: 'Request access — Aperture',
  description: 'Aperture is in a private beta. Ask for access and we will be in touch.',
};

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Request access</h1>
        <p className="text-sm text-muted-foreground">
          Aperture is in a private beta while we onboard the first teams by hand. Tell us a little about your AI spend
          and we will come back to you.
        </p>
      </div>
      <WaitlistForm referrer={ref?.slice(0, 120)} />
      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link className="text-highlight underline-offset-4 hover:underline" href="/login">
          Sign in
        </Link>
      </p>
    </>
  );
}
