import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime, roleLabel } from '@/lib/format';
import { InviteForm } from './invite-form';
import { MemberRow } from './member-row';
import { RevokeInvitation } from './revoke-invitation';

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { members }, { teams }, me] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/members', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/teams', path).then(unwrap),
    api.GET('/api/v1/me').then(unwrap),
  ]);
  const manage = can(org.role, 'members.manage');
  const invitations = manage ? unwrap(await api.GET('/api/v1/orgs/{orgId}/invitations', path)).invitations : [];
  const activeTeams = teams.filter((t) => !t.archived);

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
      <div className="space-y-8">
        <Card>
          <CardTitle>Members</CardTitle>
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                orgId={orgId}
                member={member}
                teams={activeTeams}
                isSelf={member.userId === me.user.id}
                actorRole={org.role}
                canManage={manage}
              />
            ))}
          </ul>
        </Card>

        {manage ? (
          <Card>
            <CardTitle>Pending invitations</CardTitle>
            {invitations.length === 0 ? (
              <EmptyState>No pending invitations.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="space-y-1">
                      <p>{invitation.email}</p>
                      <p className="text-xs text-muted-foreground">
                        <Badge>{roleLabel(invitation.role)}</Badge> expires{' '}
                        {formatDateTime(invitation.expiresAt, org.timezone)}
                      </p>
                    </div>
                    <RevokeInvitation orgId={orgId} invitationId={invitation.id} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {manage ? (
        <Card>
          <h2 className="mb-4 font-semibold">Invite someone</h2>
          <InviteForm orgId={orgId} teams={activeTeams} actorRole={org.role} />
        </Card>
      ) : null}
    </div>
  );
}
