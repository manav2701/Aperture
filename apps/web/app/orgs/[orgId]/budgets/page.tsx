import { can } from '@aperture/core';
import { BudgetMeter } from '@/components/budget-meter';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import type { Budget } from '@/lib/api/types';
import { EditBudget } from './edit-budget';
import { NewBudget } from './new-budget';

export default async function BudgetsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { budgets }, { teams }, { principals }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/budgets', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/teams', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/principals', path).then(unwrap),
  ]);
  const manage = can(org.role, 'budgets.manage');
  const active = budgets.filter((b) => !b.archived);
  const children = (parentId: string | null) => active.filter((b) => b.parentId === parentId);
  const scopeName = (budget: Budget) => {
    if (budget.scope === 'org') return 'organization';
    if (budget.scope === 'team') return `team ${teams.find((t) => t.id === budget.scopeId)?.name ?? ''}`;
    return principals.find((p) => p.id === budget.scopeId)?.name ?? budget.scope;
  };

  const renderTree = (parentId: string | null) => (
    <ul className={parentId === null ? 'space-y-3' : 'mt-3 space-y-3 border-l border-border pl-4'}>
      {children(parentId).map((budget) => (
        <li key={budget.id}>
          <div className="space-y-2 border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{budget.name}</span>
                <Badge>{scopeName(budget)}</Badge>
                <Badge>per {budget.period}</Badge>
                {budget.mode === 'soft' ? <Badge tone="accent">soft</Badge> : null}
                {budget.rails.length > 0 ? <Badge>{budget.rails.join(', ')}</Badge> : null}
              </div>
              {manage ? <EditBudget orgId={orgId} budget={budget} /> : null}
            </div>
            <BudgetMeter budget={budget} />
          </div>
          {children(budget.id).length > 0 ? renderTree(budget.id) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Every spend must fit in its budget and in every budget above it. Hard budgets deny; soft budgets alert."
      />
      <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
        <div>{active.length === 0 ? <EmptyState>No budgets yet.</EmptyState> : renderTree(null)}</div>
        {manage ? (
          <Card>
            <h2 className="mb-4 font-semibold">New budget</h2>
            <NewBudget
              orgId={orgId}
              budgets={active}
              teams={teams.filter((t) => !t.archived)}
              principals={principals}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
