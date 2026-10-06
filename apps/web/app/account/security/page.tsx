import Link from 'next/link';
import { Card, CardTitle, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { CreatePassword } from './create-password';
import { TwoFactorSetup } from './two-factor-setup';

export default async function SecurityPage() {
  const api = await serverApi();
  const me = unwrap(await api.GET('/api/v1/me'));
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
      <PageHeader
        title="Security"
        description="Owners, admins and finance need two-factor authentication before they can change anything."
        action={
          <Link href="/app" className="text-sm hover:text-highlight">
            ← Back
          </Link>
        }
      />
      {me.user.hasPassword ? null : (
        <Card>
          <CardTitle>Step 1: create a password</CardTitle>
          <p className="mb-4 text-sm text-muted-foreground">
            You sign in with Google, so your account has no password yet. Two-factor works with password sign-in: once
            it is on, you sign in with your email ({me.user.email}), this password and a code from your authenticator
            app. Google sign-in is then turned off for your account so it can’t skip the code.
          </p>
          <CreatePassword />
        </Card>
      )}
      <Card>
        <CardTitle>{me.user.hasPassword ? 'Two-factor authentication' : 'Step 2: two-factor authentication'}</CardTitle>
        {me.user.hasPassword ? (
          <TwoFactorSetup enabled={me.user.twoFactorEnabled} />
        ) : (
          <p className="text-sm text-muted-foreground">Create a password first.</p>
        )}
      </Card>
    </main>
  );
}
