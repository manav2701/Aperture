import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { SlackForm } from './slack-form';
import { SlackInstall } from './slack-install';

const KIND_LABELS: Record<string, string> = {
  budget_threshold: 'Budget threshold',
  credential_revoked: 'Key revoked',
  connection_broken: 'Connection broken',
  unpriced_model: 'Unpriced model',
  ledger_drift: 'Ledger check',
  media_stuck: 'Slow media job',
  approval_requested: 'Approval requested',
};

export default async function AlertsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { alerts, slack }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/alerts', path).then(unwrap),
  ]);

  return (
    <div className="grid max-w-5xl gap-8 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardTitle>Recent alerts</CardTitle>
        <p className="mb-4 text-sm text-muted-foreground">
          Owners, admins and finance get these by email. Budgets alert at 80% and 100% unless they set their own
          thresholds.
        </p>
        {alerts.length === 0 ? (
          <EmptyState>No alerts yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>
                  <Badge>{KIND_LABELS[alert.kind] ?? alert.kind}</Badge>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{JSON.stringify(alert.payload)}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(alert.createdAt, org.timezone)}
                  {alert.sentAt === null ? ' · pending' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Slack</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {slack ? 'Alerts are also posted to Slack.' : 'Post alerts to a Slack channel with an incoming webhook.'}
        </p>
        {can(org.role, 'connections.manage') ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                The Slack app posts alerts to a channel you pick and lets approvers answer requests with Approve / Deny
                buttons (they must use the same verified email in Slack and Aperture).
              </p>
              <SlackInstall orgId={orgId} />
            </div>
            <SlackForm orgId={orgId} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
