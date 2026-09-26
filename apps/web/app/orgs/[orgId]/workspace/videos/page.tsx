import { Badge, Card, EmptyState } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatAmount, formatDateTime } from '@/lib/format';
import { AutoRefresh } from './auto-refresh';
import { VideoForm } from './video-form';

export default async function VideosPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, models, { jobs }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/workspace/media-models', path).then(unwrap),
    api
      .GET('/api/v1/orgs/{orgId}/workspace/media', { params: { path: { orgId }, query: { kind: 'video' } } })
      .then(unwrap),
  ]);
  const running = jobs.some((job) => job.status === 'running' || job.status === 'expired_reconciling');

  return (
    <div className="grid gap-8 xl:grid-cols-[22rem_1fr]">
      <Card>
        {!models.storage ? (
          <p className="text-sm text-muted-foreground">Media storage isn’t configured on this deployment yet.</p>
        ) : models.videos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connect OpenRouter (or Google) to generate video.</p>
        ) : (
          <VideoForm orgId={orgId} models={models.videos} />
        )}
      </Card>
      <section aria-label="Videos" className="space-y-4">
        {running ? <AutoRefresh seconds={5} /> : null}
        {jobs.length === 0 ? (
          <EmptyState>Your videos and your team’s appear here.</EmptyState>
        ) : (
          <ul className="space-y-4">
            {jobs.map((job) => (
              <li key={job.id} className="space-y-3 border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">{job.prompt}</p>
                  <Badge tone={job.status === 'succeeded' ? 'accent' : job.status === 'failed' ? 'danger' : 'muted'}>
                    {job.status === 'running' ? `running · held $${job.estimated}` : job.status.replace('_', ' ')}
                  </Badge>
                </div>
                {job.outputs.map((output) => (
                  <video
                    key={output.url}
                    src={output.url}
                    controls
                    preload="metadata"
                    className="w-full max-w-2xl bg-muted"
                  />
                ))}
                {job.error === null ? null : <p className="text-sm text-danger">{job.error}</p>}
                <p className="font-mono text-xs text-muted-foreground">
                  {job.model} · {String(job.params.seconds ?? '')}s ·{' '}
                  {job.cost === null
                    ? `up to ${formatAmount(job.estimated, 'micros')}`
                    : formatAmount(job.cost, 'micros')}{' '}
                  · {job.by.name} · {formatDateTime(job.createdAt, org.timezone)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
