import { can } from '@aperture/core';
import Link from 'next/link';
import { BudgetMeter } from '@/components/budget-meter';
import { Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';

export default async function OverviewPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const org = unwrap(await api.GET('/api/v1/orgs/{orgId}', path));
  const role = org.role;

  const [budgets, audit, members] = await Promise.all([
    can(role, 'budgets.read') ? api.GET('/api/v1/orgs/{orgId}/budgets', path).then(unwrap) : null,
    can(role, 'audit.read')
      ? api.GET('/api/v1/orgs/{orgId}/audit', { params: { path: { orgId }, query: { limit: 8 } } }).then(unwrap)
      : null,
    can(role, 'members.read') ? api.GET('/api/v1/orgs/{orgId}/members', path).then(unwrap) : null,
  ]);
  const topLevel = budgets?.budgets.filter((b) => b.parentId === null && !b.archived) ?? [];
  const base = `/orgs/${orgId}`;

  return (
    <>
      <PageHeader title="Overview" description={`Budgets reset in ${org.timezone.replaceAll('_', ' ')} time.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        {budgets === null ? null : (
          <Card>
            <CardTitle
              action={
                <Link href={`${base}/budgets`} className="text-sm text-accent">
                  All budgets
                </Link>
              }
            >
              Top-level budgets
            </CardTitle>
            {topLevel.length === 0 ? (
              <EmptyState>No budgets yet. Start with one for the whole organization.</EmptyState>
            ) : (
              <ul className="space-y-4">
                {topLevel.map((budget) => (
                  <li key={budget.id} className="space-y-1">
                    <p className="text-sm font-medium">
                      {budget.name} <span className="text-muted-foreground">· per {budget.period}</span>
                    </p>
                    <BudgetMeter budget={budget} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {members === null ? null : (
          <Card>
            <CardTitle
              action={
                <Link href={`${base}/settings/members`} className="text-sm text-accent">
                  Manage
                </Link>
              }
            >
              People
            </CardTitle>
            <p className="text-3xl font-bold">{members.members.length}</p>
            <p className="text-sm text-muted-foreground">{members.members.length === 1 ? 'member' : 'members'}</p>
          </Card>
        )}

        {audit === null ? null : (
          <Card className="lg:col-span-2">
            <CardTitle
              action={
                <Link href={`${base}/audit`} className="text-sm text-accent">
                  Audit log
                </Link>
              }
            >
              Recent activity
            </CardTitle>
            <ul className="divide-y divide-border">
              {audit.events.map((event) => (
                <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span className="font-mono">{event.action}</span>
                  <span className="text-muted-foreground">{formatDateTime(event.occurredAt, org.timezone)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
