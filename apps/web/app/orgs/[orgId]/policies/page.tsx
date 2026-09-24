import { can } from '@aperture/core';
import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { PolicyEditor } from './policy-editor';
import { PolicySimulator } from './policy-simulator';

type Scope = 'org' | 'team' | 'principal';

export default async function PoliciesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ scope?: string; id?: string }>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { policies }, { teams }, { principals }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/policies', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/teams', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/principals', path).then(unwrap),
  ]);

  const scopes: { scope: Scope; id: string; label: string }[] = [
    { scope: 'org', id: orgId, label: 'Organization' },
    ...teams.filter((t) => !t.archived).map((t) => ({ scope: 'team' as const, id: t.id, label: `Team · ${t.name}` })),
    ...principals
      .filter((p) => p.status !== 'revoked')
      .map((p) => ({
        scope: 'principal' as const,
        id: p.id,
        label: `${p.kind === 'agent' ? 'Agent' : 'Person'} · ${p.name}`,
      })),
  ];
  const selected = scopes.find((s) => s.scope === query.scope && s.id === query.id) ?? scopes[0];
  if (selected === undefined) throw new Error('the organization scope is always present');

  const detail = unwrap(
    await api.GET('/api/v1/orgs/{orgId}/policies/{scope}/{scopeId}', {
      params: { path: { orgId, scope: selected.scope, scopeId: selected.id } },
    }),
  );
  const withPolicy = new Set(policies.map((p) => `${p.scope}:${p.scopeId}`));
  const href = (s: { scope: Scope; id: string }) => `/orgs/${orgId}/policies?scope=${s.scope}&id=${s.id}`;

  return (
    <>
      <PageHeader
        title="Policies"
        description="Rules every spend must pass, at each level: organization, team, then the person or agent. Every level must allow."
      />
      <div className="grid gap-8 xl:grid-cols-[16rem_1fr]">
        <nav aria-label="Policy scopes" className="space-y-1">
          {scopes.map((s) => (
            <Link
              key={`${s.scope}:${s.id}`}
              href={href(s)}
              className={cn(
                'flex items-center justify-between gap-2 px-3 py-1.5 text-sm',
                s === selected ? 'bg-muted' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="truncate">{s.label}</span>
              {withPolicy.has(`${s.scope}:${s.id}`) ? <Badge tone="accent">set</Badge> : null}
            </Link>
          ))}
        </nav>

        <div className="space-y-8">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{selected.label}</h2>
              <p className="text-sm text-muted-foreground">
                {detail.active === null
                  ? 'No policy yet — everything is allowed at this level.'
                  : `Version ${String(detail.active.version)} · ${formatDateTime(detail.active.createdAt, org.timezone)}`}
              </p>
            </div>
            <PolicyEditor
              key={`${selected.scope}:${selected.id}:${String(detail.active?.version ?? 0)}`}
              orgId={orgId}
              scope={selected.scope}
              scopeId={selected.id}
              version={detail.active?.version ?? 0}
              document={detail.active?.document ?? { rules: [] }}
              canEdit={can(org.role, 'policies.manage')}
            />
            {detail.versions.length > 1 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Earlier versions are kept for the audit trail:{' '}
                {detail.versions
                  .slice(1)
                  .map((v) => `v${String(v.version)}`)
                  .join(', ')}
                .
              </p>
            ) : null}
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold">Simulator</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Check what would happen to a spend right now, using the published policies above.
            </p>
            <PolicySimulator
              orgId={orgId}
              principals={principals.filter((p) => p.status === 'active').map((p) => ({ id: p.id, name: p.name }))}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
