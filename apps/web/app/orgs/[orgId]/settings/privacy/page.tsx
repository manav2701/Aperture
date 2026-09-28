import { can } from '@aperture/core';
import { Card, CardTitle } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { DeletionForm, ExportButton, RetentionForm } from './privacy-forms';

export default async function PrivacyPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, settings] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/settings/privacy', path).then(unwrap),
  ]);
  const manage = can(org.role, 'org.update');

  return (
    <div className="grid max-w-5xl gap-8 lg:grid-cols-2">
      <Card>
        <CardTitle>Retention</CardTitle>
        <p className="mb-4 text-sm text-muted-foreground">
          Gateway request logs and generated images and videos are deleted after these periods. The spend ledger and the
          audit log are never deleted.
        </p>
        {manage ? (
          <RetentionForm orgId={orgId} requestLogDays={settings.requestLogDays} mediaDays={settings.mediaDays} />
        ) : (
          <p className="text-sm">
            Request logs: {settings.requestLogDays} days · media: {settings.mediaDays} days
          </p>
        )}
      </Card>
      <Card>
        <CardTitle>Your data</CardTitle>
        <p className="mb-4 text-sm text-muted-foreground">
          Download everything this organization has in Aperture as JSON (secrets and key hashes are left out).
        </p>
        {can(org.role, 'audit.export') ? <ExportButton orgId={orgId} /> : null}
      </Card>
      {org.role === 'owner' ? (
        <Card>
          <CardTitle>Delete the organization</CardTitle>
          {settings.deletion === 'requested' ? (
            <p className="mb-4 text-sm">
              Deletion was requested
              {settings.deletionRequestedAt === null
                ? ''
                : ` on ${formatDateTime(settings.deletionRequestedAt, org.timezone)}`}
              . After 30 days all keys and agents are revoked and the data is deleted. You can still cancel.
            </p>
          ) : settings.deletion === 'scheduled' ? (
            <p className="text-sm">Deletion is in progress.</p>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">
              Starts a 30-day grace period. The audit log is kept for the retention period in your contract.
            </p>
          )}
          {settings.deletion === 'scheduled' ? null : (
            <DeletionForm orgId={orgId} orgName={org.name} pending={settings.deletion === 'requested'} />
          )}
        </Card>
      ) : null}
    </div>
  );
}
