import { Card, EmptyState } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatAmount, formatDateTime } from '@/lib/format';
import { ImageForm } from './image-form';

export default async function ImagesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, models, { jobs }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/workspace/media-models', path).then(unwrap),
    api
      .GET('/api/v1/orgs/{orgId}/workspace/media', { params: { path: { orgId }, query: { kind: 'image' } } })
      .then(unwrap),
  ]);

  return (
    <div className="grid gap-8 xl:grid-cols-[22rem_1fr]">
      <Card>
        {!models.storage ? (
          <p className="text-sm text-muted-foreground">Media storage isn’t configured on this deployment yet.</p>
        ) : models.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connect OpenRouter (or OpenAI) to generate images.</p>
        ) : (
          <ImageForm orgId={orgId} models={models.images} />
        )}
      </Card>
      <section aria-label="Gallery">
        {jobs.length === 0 ? (
          <EmptyState>Your images and your team’s appear here.</EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {jobs.flatMap((job) =>
              job.outputs.length === 0
                ? [
                    <li key={job.id} className="border border-border p-3 text-sm">
                      <p className="text-danger">{job.error ?? job.status}</p>
                      <p className="text-muted-foreground">{job.prompt}</p>
                    </li>,
                  ]
                : job.outputs.map((output, index) => (
                    <li key={`${job.id}-${String(index)}`} className="space-y-2 border border-border p-2">
                      <a href={output.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private 15-minute signed URLs can't go through the image optimizer */}
                        <img
                          src={output.url}
                          alt={job.prompt}
                          loading="lazy"
                          className="aspect-square w-full bg-muted object-cover"
                        />
                      </a>
                      <p className="line-clamp-2 text-sm">{job.prompt}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {job.model} · {job.cost === null ? '—' : formatAmount(job.cost, 'micros')} · {job.by.name} ·{' '}
                        {formatDateTime(job.createdAt, org.timezone)}
                      </p>
                    </li>
                  )),
            )}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Links expire after 15 minutes; reload the page for fresh ones.
        </p>
      </section>
    </div>
  );
}
