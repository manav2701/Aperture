import { can } from '@aperture/core';
import { PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { ApprovedToolsForm } from './approved-tools';

export default async function ToolsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, catalogue] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/tools', path).then(unwrap),
  ]);
  return (
    <>
      <PageHeader
        title="AI tools"
        description="The tools your organization approves. People can still declare others; those show up as insights, not violations."
      />
      <ApprovedToolsForm orgId={orgId} tools={catalogue.tools} editable={can(org.role, 'seats.manage')} />
    </>
  );
}
