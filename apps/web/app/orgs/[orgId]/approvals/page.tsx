import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { DecideApproval } from './decide';

export default async function ApprovalsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { approvals }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/approvals', path).then(unwrap),
  ]);
  const decide = can(org.role, 'approvals.decide');
  const pending = approvals.filter((a) => a.status === 'pending');
  const decided = approvals.filter((a) => a.status !== 'pending');

  return (
    <>
      <PageHeader
        title="Approvals"
        description="When policy sends a request to a person, it waits here. Approving lets that one request through, up to the amount you approve. Nobody can approve their own request or one from an agent they own. Requests nobody decides are denied after 24 hours."
      />
      <div className="space-y-8">
        <Card>
          <CardTitle>Waiting ({pending.length})</CardTitle>
          {pending.length === 0 ? (
            <EmptyState>Nothing is waiting for a decision.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {pending.map((approval) => (
                <li key={approval.id} className="space-y-2 border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {approval.requester.name} wants up to ${approval.amount}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      expires {formatDateTime(approval.expiresAt, org.timezone)}
                    </span>
                  </div>
                  <p className="text-sm">{approval.purpose}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {approval.rail} · {approval.resource}
                  </p>
                  {Array.isArray(approval.context.reasons) ? (
                    <p className="text-xs text-muted-foreground">
                      Why:{' '}
                      {(approval.context.reasons as { message?: unknown }[])
                        .map((r) => (typeof r.message === 'string' ? r.message : ''))
                        .join('; ')}
                    </p>
                  ) : null}
                  {decide ? <DecideApproval orgId={orgId} approvalId={approval.id} amount={approval.amount} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Decided</CardTitle>
          {decided.length === 0 ? (
            <EmptyState>No decisions yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {decided.map((approval) => (
                <li key={approval.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {approval.requester.name} · <span className="font-mono text-xs">{approval.resource}</span> · $
                    {approval.approvedAmount ?? approval.amount}
                    {approval.note === null ? null : <span className="text-muted-foreground"> — {approval.note}</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {approval.decidedAt === null ? '' : formatDateTime(approval.decidedAt, org.timezone)}
                    </span>
                    <Badge tone={approval.status === 'approved' || approval.status === 'used' ? 'accent' : 'danger'}>
                      {approval.status}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
