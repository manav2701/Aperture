import { can, formatShare } from '@aperture/core';
import Link from 'next/link';
import { BudgetMeter } from '@/components/budget-meter';
import { Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatAmount, formatDateTime } from '@/lib/format';

export default async function OverviewPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const org = unwrap(await api.GET('/api/v1/orgs/{orgId}', path));
  const role = org.role;

  const monthStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [budgets, audit, members, spend, onboarding] = await Promise.all([
    can(role, 'budgets.read') ? api.GET('/api/v1/orgs/{orgId}/budgets', path).then(unwrap) : null,
    can(role, 'audit.read')
      ? api.GET('/api/v1/orgs/{orgId}/audit', { params: { path: { orgId }, query: { limit: 8 } } }).then(unwrap)
      : null,
    can(role, 'members.read') ? api.GET('/api/v1/orgs/{orgId}/members', path).then(unwrap) : null,
    can(role, 'spend.read')
      ? api
          .GET('/api/v1/orgs/{orgId}/spend', {
            params: { path: { orgId }, query: { from: monthStart, groupBy: 'provider' } },
          })
          .then(unwrap)
      : null,
    api.GET('/api/v1/orgs/{orgId}/onboarding', path).then((result) => result.data?.steps ?? []),
  ]);
  const [posture, inventory] = await Promise.all([
    can(role, 'posture.read') ? api.GET('/api/v1/orgs/{orgId}/posture', path).then((r) => r.data ?? null) : null,
    can(role, 'inventory.read') ? api.GET('/api/v1/orgs/{orgId}/inventory', path).then((r) => r.data ?? null) : null,
  ]);
  const enforced = inventory?.coverage.find((share) => share.status === 'enforced')?.basisPoints ?? null;
  const remaining = onboarding.filter((step) => !step.done);
  const topLevel = budgets?.budgets.filter((b) => b.parentId === null && !b.archived) ?? [];
  const base = `/orgs/${orgId}`;

  return (
    <>
      <PageHeader title="Overview" description={`Budgets reset in ${org.timezone.replaceAll('_', ' ')} time.`} />
      {remaining.length === 0 ? null : (
        <Card className="mb-6">
          <CardTitle>Getting started</CardTitle>
          <ol className="space-y-1 text-sm">
            {onboarding.map((step) => (
              <li key={step.id} className={step.done ? 'text-muted-foreground line-through' : ''}>
                {step.done ? (
                  step.label
                ) : (
                  <Link href={step.href} className="hover:text-highlight">
                    {step.label} →
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {posture === null && inventory === null ? null : (
        <div className="mb-6 grid gap-6 sm:grid-cols-2">
          {posture === null ? null : (
            <Link href={`${base}/posture`} className="border border-border p-5 hover:border-accent">
              <p className="text-sm text-muted-foreground">Governance posture</p>
              <p className="font-mono text-3xl">{posture.run === null ? '—' : `${String(posture.run.score)}/100`}</p>
              <p className="text-xs text-muted-foreground">
                {posture.run === null ? 'Run the checks' : `grade ${posture.run.grade} · ${String(posture.results.filter((r) => r.status === 'fail').length)} failing`}
              </p>
            </Link>
          )}
          {inventory === null ? null : (
            <Link href={`${base}/inventory`} className="border border-border p-5 hover:border-accent">
              <p className="text-sm text-muted-foreground">AI spend Aperture enforces (30 days)</p>
              <p className="font-mono text-3xl">{enforced === null || inventory.coverage.every((c) => c.basisPoints === 0) ? '—' : formatShare(enforced)}</p>
              <p className="text-xs text-muted-foreground">{inventory.rows.length} things can spend</p>
            </Link>
          )}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {budgets === null ? null : (
          <Card>
            <CardTitle
              action={
                <Link href={`${base}/budgets`} className="text-sm text-highlight">
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

        {spend === null ? null : (
          <Card>
            <CardTitle
              action={
                <Link href={`${base}/spend`} className="text-sm text-highlight">
                  Spend
                </Link>
              }
            >
              Last 30 days
            </CardTitle>
            <p className="font-mono text-3xl font-bold">{formatAmount(spend.total, 'micros')}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {spend.groups.map((group) => (
                <li key={group.key} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{group.label}</span>
                  <span className="font-mono">{formatAmount(group.amount, 'micros')}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {members === null ? null : (
          <Card>
            <CardTitle
              action={
                <Link href={`${base}/settings/members`} className="text-sm text-highlight">
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
                <Link href={`${base}/audit`} className="text-sm text-highlight">
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
