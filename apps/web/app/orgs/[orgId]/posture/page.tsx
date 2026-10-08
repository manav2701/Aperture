import { can } from '@aperture/core';
import Link from 'next/link';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { RevokeWaiver, RunNow, WaiveCheck } from './posture-actions';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const statusTone = (status: string) => (status === 'pass' ? 'accent' : status === 'fail' || status === 'unknown' ? 'danger' : 'muted');

export default async function PosturePage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, posture, history] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/posture', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/posture/runs', { params: { path: { orgId }, query: { limit: 30 } } }).then(unwrap),
  ]);
  const canWaive = can(org.role, 'posture.waive');
  const base = `/orgs/${orgId}`;
  const failing = posture.results.filter((r) => r.status === 'fail' || r.status === 'unknown');
  const passing = posture.results.filter((r) => r.status === 'pass' || r.status === 'waived');
  const notApplicable = posture.results.filter((r) => r.status === 'not_applicable');
  const rationale = new Map(posture.catalogue.map((c) => [c.id, c.rationale]));

  return (
    <>
      <PageHeader
        title="Posture"
        description="Checks on how safely this organization is set up. Each failure links to where you fix it."
        action={<RunNow orgId={orgId} />}
      />
      {posture.run === null ? (
        <EmptyState>The checks haven’t run yet. Run them now; after that they run every day.</EmptyState>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <p className="text-sm text-muted-foreground">Score</p>
              <p className="font-mono text-5xl">
                {posture.run.score}
                <span className="text-xl text-muted-foreground">/100</span>
              </p>
              <p className="mt-2 text-sm">
                Grade <span className="font-semibold">{posture.run.grade}</span> · checked{' '}
                {formatDateTime(posture.run.ranAt, org.timezone)}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-muted-foreground">Failing</p>
              <p className="font-mono text-5xl">{failing.length}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {failing.filter((f) => f.severity === 'critical').length} critical ·{' '}
                {failing.filter((f) => f.severity === 'high').length} high
              </p>
            </Card>
            <Card>
              <p className="text-sm text-muted-foreground">History</p>
              <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="mt-2 h-16 w-full" role="img" aria-label="Score history, oldest first">
                {[...history.runs].reverse().map((run, index) => {
                  const height = Math.max(4, run.score);
                  return (
                    <rect key={run.id} x={index * 10} y={100 - height} width={7} height={height} className="fill-accent">
                      <title>{`${String(run.score)} · ${formatDateTime(run.ranAt, org.timezone)}`}</title>
                    </rect>
                  );
                })}
              </svg>
            </Card>
          </div>

          {SEVERITIES.map((severity) => {
            const items = failing.filter((r) => r.severity === severity);
            if (items.length === 0) return null;
            return (
              <Card key={severity}>
                <CardTitle>
                  <span className="capitalize">{severity}</span> · {items.length} failing
                </CardTitle>
                <ul className="divide-y divide-border">
                  {items.map((result) => (
                    <li key={result.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{result.title}</span>
                        <span className="flex items-center gap-2">
                          <Badge tone={statusTone(result.status)}>{result.status}</Badge>
                          <Link href={`${base}${result.fixHref}`} className="text-sm underline hover:text-highlight">
                            Fix
                          </Link>
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{rationale.get(result.id)}</p>
                      {result.detail === null ? null : <p className="font-mono text-xs">{result.detail}</p>}
                      {result.subjects.length === 0 ? null : (
                        <ul className="flex flex-wrap gap-1">
                          {result.subjects.slice(0, 20).map((subject) => (
                            <li key={`${subject.kind}:${subject.id}`}>
                              {subject.kind === 'agent' ? (
                                <Link href={`${base}/agents/${subject.id}`}>
                                  <Badge>{subject.label}</Badge>
                                </Link>
                              ) : (
                                <Badge>{subject.label}</Badge>
                              )}
                            </li>
                          ))}
                          {result.subjects.length > 20 ? <li className="text-xs">+{result.subjects.length - 20} more</li> : null}
                        </ul>
                      )}
                      {canWaive ? <WaiveCheck orgId={orgId} checkId={result.id} subjects={result.subjects} /> : null}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle>Waivers</CardTitle>
              {posture.waivers.length === 0 ? (
                <EmptyState>No accepted risks.</EmptyState>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {posture.waivers.map((waiver) => (
                    <li key={waiver.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <span className="min-w-0">
                        <span className="block font-mono text-xs">
                          {waiver.checkId}
                          {waiver.subjectId === null ? '' : ` · ${waiver.subjectId}`}
                        </span>
                        <span className="block">{waiver.reason}</span>
                        <span className="text-xs text-muted-foreground">until {formatDateTime(waiver.expiresAt, org.timezone)}</span>
                      </span>
                      {canWaive ? <RevokeWaiver orgId={orgId} waiverId={waiver.id} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardTitle>Passing ({passing.length})</CardTitle>
              <ul className="space-y-1 text-sm">
                {passing.map((result) => (
                  <li key={result.id} className="flex justify-between gap-2">
                    <span>{result.title}</span>
                    <Badge tone={statusTone(result.status)}>{result.status}</Badge>
                  </li>
                ))}
              </ul>
              {notApplicable.length === 0 ? null : (
                <p className="mt-4 text-xs text-muted-foreground">
                  {notApplicable.length} checks don’t apply yet (rails or features you haven’t set up).
                </p>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
