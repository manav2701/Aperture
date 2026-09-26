import { Card } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { Chat } from './chat';
import { PersonalKey } from './personal-key';

export default async function WorkspaceChatPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const workspace = unwrap(await api.GET('/api/v1/orgs/{orgId}/workspace', { params: { path: { orgId } } }));

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_20rem]">
      {workspace.available ? (
        <Chat orgId={orgId} />
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">The gateway isn’t enabled on this deployment yet.</p>
        </Card>
      )}
      <Card>
        <h2 className="mb-2 font-semibold">Personal key</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          For your own scripts and tools. It spends as you, under the same budgets and policies.
        </p>
        <PersonalKey orgId={orgId} gatewayUrl={workspace.gatewayUrl} />
      </Card>
    </div>
  );
}
