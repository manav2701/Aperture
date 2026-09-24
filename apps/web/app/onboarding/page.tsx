import type { Metadata } from 'next';
import { serverApi, unwrap } from '@/lib/api/server';
import { CreateOrgForm } from './create-org-form';

export const metadata: Metadata = { title: 'Create your organization — Aperture' };

export default async function OnboardingPage() {
  const api = await serverApi();
  const me = unwrap(await api.GET('/api/v1/me'));
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-2">
        <p className="font-mono text-sm uppercase tracking-widest text-accent">Aperture</p>
        <h1 className="text-2xl font-bold">Welcome, {me.user.name}</h1>
        <p className="text-muted-foreground">
          Create an organization for your company. You can invite your team and set budgets next.
        </p>
      </div>
      <CreateOrgForm />
    </main>
  );
}
