import { redirect } from 'next/navigation';
import { serverApi, unwrap } from '@/lib/api/server';

/** Where sign-in lands: the first org, or onboarding when there is none yet. */
export default async function AppEntryPage() {
  const api = await serverApi();
  const me = unwrap(await api.GET('/api/v1/me'));
  const [first] = me.memberships;
  redirect(first === undefined ? '/onboarding' : `/orgs/${first.orgId}`);
}
