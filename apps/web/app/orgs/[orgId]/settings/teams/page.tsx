import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { NewTeam } from './new-team';
import { TeamActions } from './team-actions';

export default async function TeamsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { teams }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/teams', path).then(unwrap),
  ]);
  const manage = can(org.role, 'teams.manage');

  return (
    <div className="grid max-w-4xl gap-8 lg:grid-cols-[1fr_18rem]">
      <Card>
        <CardTitle>Teams</CardTitle>
        {teams.length === 0 ? (
          <EmptyState>No teams yet. Teams group people for budgets and policies.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {teams.map((team) => (
              <li key={team.id} className="flex items-center justify-between gap-3 py-3">
                <span className={team.archived ? 'text-muted-foreground' : ''}>
                  {team.name} {team.archived ? <Badge>archived</Badge> : null}
                </span>
                {manage ? <TeamActions orgId={orgId} team={team} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {manage ? (
        <Card>
          <h2 className="mb-4 font-semibold">New team</h2>
          <NewTeam orgId={orgId} />
        </Card>
      ) : null}
    </div>
  );
}
