import { can } from '@aperture/core';
import { Card } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { OrgForm } from './org-form';

export default async function OrgSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const org = unwrap(await api.GET('/api/v1/orgs/{orgId}', { params: { path: { orgId } } }));
  return (
    <Card className="max-w-lg">
      <OrgForm org={org} canEdit={can(org.role, 'org.update')} />
    </Card>
  );
}
