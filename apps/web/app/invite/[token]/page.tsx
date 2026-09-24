import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api/server';
import { AcceptInvitation } from './accept-invitation';

export const metadata: Metadata = { title: 'Invitation — Aperture' };

const unavailable = {
  accepted: 'This invitation has already been accepted.',
  revoked: 'This invitation was withdrawn. Ask your admin for a new one.',
  expired: 'This invitation has expired. Ask your admin for a new one.',
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const api = await serverApi();
  const { data: invitation } = await api.GET('/api/v1/invitations/{token}', { params: { path: { token } } });
  if (invitation === undefined) notFound();
  const me = await api.GET('/api/v1/me');
  const signedInAs = me.data?.user.email;
  const here = `/invite/${token}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <p className="font-mono text-sm uppercase tracking-widest text-accent">Aperture</p>
      <h1 className="text-2xl font-bold">Join {invitation.orgName}</h1>
      <p className="text-muted-foreground">
        You were invited as <strong className="text-foreground">{invitation.role.replace('_', ' ')}</strong> using{' '}
        <strong className="text-foreground">{invitation.email}</strong>.
      </p>

      {invitation.status !== 'pending' ? (
        <p className="border-l-2 border-danger pl-3">{unavailable[invitation.status]}</p>
      ) : signedInAs === undefined ? (
        <div className="flex gap-3">
          <Link
            href={`/signup?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invitation.email)}`}
            className="bg-accent px-4 py-2 font-medium text-accent-foreground"
          >
            Create an account
          </Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`} className="border border-border px-4 py-2">
            Sign in
          </Link>
        </div>
      ) : signedInAs.toLowerCase() !== invitation.email ? (
        <p className="border-l-2 border-danger pl-3">
          You are signed in as {signedInAs}. Sign out and sign in as {invitation.email} to accept.
        </p>
      ) : (
        <AcceptInvitation token={token} />
      )}
    </main>
  );
}
