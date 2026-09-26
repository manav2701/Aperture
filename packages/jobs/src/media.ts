import { and, asc, eq, inArray, release, resolveUpstreamKey, schema, settle, withOrg, withSystem } from '@aperture/db';
import {
  BILLS_ON_FAILURE,
  extensionFor,
  googleMedia,
  mediaKey,
  openRouterMedia,
  type MediaProvider,
  type VideoStatus,
} from '@aperture/media';
import { queueAlert } from './alerts';
import { dbOf, type JobDeps } from './deps';

type MediaJob = typeof schema.mediaJobs.$inferSelect;

const STUCK_ALERT_MS = 2 * 60 * 60 * 1000;
/** After a day without a final answer we stop asking and charge the reservation. */
const GIVE_UP_MS = 24 * 60 * 60 * 1000;

function clientFor(provider: string, key: string, deps: JobDeps) {
  if (provider === 'google') return googleMedia(key, deps.fetch);
  return openRouterMedia(key, deps.fetch);
}

async function finish(
  deps: JobDeps,
  job: MediaJob,
  outcome: { status: 'succeeded' | 'failed'; cost: bigint; outputs?: MediaJob['outputs']; error?: string },
) {
  await withOrg(dbOf(deps), job.orgId, async (tx) => {
    if (job.holdId !== null) {
      const [hold] = await tx
        .select({ status: schema.holds.status })
        .from(schema.holds)
        .where(eq(schema.holds.id, job.holdId));
      const open = hold?.status === 'open' || hold?.status === 'expired_reconciling';
      if (open && outcome.cost > 0n) {
        await settle(tx, {
          orgId: job.orgId,
          holdId: job.holdId,
          actualAmount: outcome.cost,
          meta: { mediaJobId: job.id },
        });
      } else if (open) {
        await release(tx, { orgId: job.orgId, holdId: job.holdId });
      }
    }
    // The request row was written at submission; it gets the final cost now.
    if (job.holdId !== null) {
      await tx
        .update(schema.gatewayRequests)
        .set({ cost: outcome.cost, completedAt: new Date() })
        .where(eq(schema.gatewayRequests.holdId, job.holdId));
    }
    await tx
      .update(schema.mediaJobs)
      .set({
        status: outcome.status,
        cost: outcome.cost,
        outputs: outcome.outputs ?? [],
        error: outcome.error ?? null,
        completedAt: new Date(),
      })
      .where(eq(schema.mediaJobs.id, job.id));
  });
}

async function pollOne(deps: JobDeps, job: MediaJob): Promise<void> {
  const storage = deps.storage;
  if (storage === undefined || job.providerJobId === null) return;
  const key = await withOrg(dbOf(deps), job.orgId, (tx) =>
    resolveUpstreamKey(tx, deps.ring, { orgId: job.orgId, provider: job.provider }),
  );
  const age = Date.now() - job.createdAt.getTime();
  if (key === undefined) {
    // We can't ask the provider any more; it may still charge, so keep the reservation.
    await finish(deps, job, {
      status: 'failed',
      cost: job.estimated,
      error: 'the provider connection was removed before the job finished',
    });
    return;
  }

  const client = clientFor(job.provider, key, deps);
  let status: VideoStatus;
  try {
    status = await client.pollVideo(job.providerJobId);
  } catch (error) {
    deps.logger.warn({ err: error, jobId: job.id }, 'media poll failed; will retry');
    status = { state: 'running' };
  }

  if (status.state === 'running') {
    const [hold] =
      job.holdId === null
        ? []
        : await withOrg(dbOf(deps), job.orgId, (tx) =>
            tx
              .select({ status: schema.holds.status })
              .from(schema.holds)
              .where(eq(schema.holds.id, job.holdId ?? '')),
          );
    const reconciling = hold?.status === 'expired_reconciling';
    await withOrg(dbOf(deps), job.orgId, (tx) =>
      tx
        .update(schema.mediaJobs)
        .set({ pollCount: job.pollCount + 1, ...(reconciling ? { status: 'expired_reconciling' as const } : {}) })
        .where(eq(schema.mediaJobs.id, job.id)),
    );
    if (age > STUCK_ALERT_MS) {
      await queueAlert(deps, job.orgId, {
        dedupeKey: `media-stuck:${job.id}`,
        kind: 'media_stuck',
        payload: { model: job.model, job: job.id, minutes: Math.round(age / 60_000) },
      });
    }
    if (age > GIVE_UP_MS) {
      await finish(deps, job, { status: 'failed', cost: job.estimated, error: 'the provider never finished the job' });
    }
    return;
  }

  if (status.state === 'failed') {
    const billed = status.exactCost ?? (BILLS_ON_FAILURE[job.provider as MediaProvider] ? job.estimated : 0n);
    await finish(deps, job, { status: 'failed', cost: billed, error: status.reason });
    return;
  }

  const outputs: MediaJob['outputs'] = [];
  for (const [index, output] of status.outputs.entries()) {
    const file = await client.downloadVideo(job.providerJobId, output);
    const objectKey = mediaKey(job.orgId, job.id, index, extensionFor(file.contentType));
    await storage.put(objectKey, file.bytes, file.contentType);
    outputs.push({ key: objectKey, contentType: file.contentType, bytes: file.bytes.byteLength });
  }
  // Providers without a reported cost bill the requested seconds, which is what we reserved.
  await finish(deps, job, { status: 'succeeded', cost: status.exactCost ?? job.estimated, outputs });
}

/** Advances every unfinished video job (G12: jobs past their hold keep being asked). */
export async function pollMediaJobs(deps: JobDeps): Promise<number> {
  if (deps.storage === undefined) return 0;
  const jobs = await withSystem(dbOf(deps), (tx) =>
    tx
      .select()
      .from(schema.mediaJobs)
      .where(
        and(eq(schema.mediaJobs.kind, 'video'), inArray(schema.mediaJobs.status, ['running', 'expired_reconciling'])),
      )
      .orderBy(asc(schema.mediaJobs.createdAt))
      .limit(50),
  );
  for (const job of jobs) {
    try {
      await pollOne(deps, job);
    } catch (error) {
      deps.logger.error({ err: error, jobId: job.id }, 'media job update failed');
    }
  }
  return jobs.length;
}
