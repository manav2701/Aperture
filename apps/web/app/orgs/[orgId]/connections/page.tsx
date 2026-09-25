import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { TIER_LABELS } from '@/lib/tiers';
import { ConnectForm } from './connect-form';
import { ConnectionActions } from './connection-actions';
import { KeysTable } from './keys-table';

export default async function ConnectionsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { providers }, { connections }, { credentials }, { principals }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/providers', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/connections', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/credentials', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/principals', path).then(unwrap),
  ]);
  const manage = can(org.role, 'connections.manage');
  const active = connections.filter((connection) => connection.status !== 'disabled');
  const assignable = principals.filter((p) => p.status !== 'revoked').map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader
        title="Connections"
        description="Connect the AI provider accounts your company already has. Aperture sees who spends what and enforces budgets there too."
      />
      <div className="grid gap-8 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          {active.length === 0 ? (
            <EmptyState>No providers connected yet.</EmptyState>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {active.map((connection) => (
                <Card key={connection.id}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">{connection.name}</h2>
                    <Badge tone={connection.status === 'broken' ? 'danger' : 'accent'}>{connection.status}</Badge>
                  </div>
                  <p className="text-sm font-medium">{TIER_LABELS[connection.tier].title}</p>
                  <p className="mb-3 text-xs text-muted-foreground">{TIER_LABELS[connection.tier].detail}</p>
                  <dl className="mb-3 grid grid-cols-2 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Keys</dt>
                    <dd>
                      {connection.keys}
                      {connection.unassigned > 0 ? (
                        <span className="text-danger"> · {connection.unassigned} unassigned</span>
                      ) : null}
                    </dd>
                    <dt className="text-muted-foreground">Gateway</dt>
                    <dd>{connection.gatewayReady ? 'ready' : 'not set up'}</dd>
                    <dt className="text-muted-foreground">Last sync</dt>
                    <dd>
                      {connection.lastSyncedAt === null ? '—' : formatDateTime(connection.lastSyncedAt, org.timezone)}
                    </dd>
                  </dl>
                  {connection.lastError === null ? null : (
                    <p role="alert" className="mb-3 border-l-2 border-danger pl-3 text-xs text-danger">
                      {connection.lastError}
                    </p>
                  )}
                  {manage ? <ConnectionActions orgId={orgId} connection={connection} /> : null}
                </Card>
              ))}
            </div>
          )}

          <Card>
            <CardTitle>Provider keys</CardTitle>
            <KeysTable
              orgId={orgId}
              credentials={credentials.filter((c) => !c.managedByGateway)}
              connections={active.filter((c) => c.capabilities.createKey && c.status === 'active')}
              principals={assignable}
              canManage={manage}
            />
          </Card>
        </div>

        {manage ? (
          <Card>
            <h2 className="mb-4 font-semibold">Connect a provider</h2>
            <ConnectForm orgId={orgId} providers={providers} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
