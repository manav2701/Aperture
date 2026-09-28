import Link from 'next/link';
import { Card, CardTitle, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
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
          <Link href="/app" className="text-sm hover:text-accent">
            ← Back
          </Link>
        }
      />
      <Card>
        <CardTitle>Two-factor authentication</CardTitle>
        <TwoFactorSetup enabled={me.user.twoFactorEnabled} />
      </Card>
    </main>
  );
}
