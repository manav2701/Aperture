import { can } from '@aperture/core';
import { Card, CardTitle } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { BillingActions } from './billing-actions';

const limit = (value: number | null) => (value === null ? 'unlimited' : String(value));

export default async function BillingPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, billing] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/billing', path).then(unwrap),
  ]);
  return (
    <div className="grid max-w-5xl gap-8 lg:grid-cols-2">
      <Card>
        <CardTitle>Plan</CardTitle>
        <p className="text-lg font-semibold">{billing.label}</p>
        {billing.status === null ? null : (
          <p className="text-sm text-muted-foreground">Subscription: {billing.status}</p>
        )}
        {billing.pilotEndsAt === null ? null : (
          <p className="text-sm text-muted-foreground">
            Pilot until {formatDateTime(billing.pilotEndsAt, org.timezone)}
          </p>
        )}
        {billing.currentPeriodEnd === null ? null : (
          <p className="text-sm text-muted-foreground">
            Renews {formatDateTime(billing.currentPeriodEnd, org.timezone)}
          </p>
        )}
        <ul className="mt-4 space-y-1 text-sm">
          <li>
            Members: {billing.usage.members} of {limit(billing.limits.members)}
          </li>
          <li>
            Agents: {billing.usage.agents} of {limit(billing.limits.agents)}
          </li>
          <li>
            Connections: {billing.usage.connections} of {limit(billing.limits.connections)}
          </li>
        </ul>
      </Card>
      {billing.enabled && can(org.role, 'org.update') ? (
        <Card>
          <CardTitle>Change plan</CardTitle>
          <BillingActions orgId={orgId} hasSubscription={billing.status !== null} />
        </Card>
      ) : null}
    </div>
  );
}
