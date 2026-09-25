import type { DatabaseHandle } from '@aperture/db';
import type { Logger } from '@aperture/runtime';

export interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
}

export interface Scheduler {
  /** Runs one job now (tests, and the API's "sync now" button). */
  runNow: (name: string) => Promise<boolean>;
  stop: () => Promise<void>;
}

/**
 * Runs each job on its interval. A job runs in at most one process at a time: it holds a
 * session advisory lock named after the job for as long as it runs, so the API (RUN_WORKER)
 * and a dedicated worker can both schedule jobs without doubling up.
 */
export function startScheduler(options: { database: DatabaseHandle; logger: Logger; jobs: Job[] }): Scheduler {
  const { database, logger } = options;
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<Promise<unknown>>();
  let stopped = false;

  const runExclusive = async (job: Job): Promise<boolean> => {
    const client = await database.pool.connect();
    try {
      const lock = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtextextended($1, 0)) as ok', [
        `aperture:job:${job.name}`,
      ]);
      if (lock.rows[0]?.ok !== true) return false;
      const started = Date.now();
      try {
        await job.run();
        logger.debug({ job: job.name, ms: Date.now() - started }, 'job finished');
      } catch (error) {
        logger.error({ job: job.name, err: error }, 'job failed');
      } finally {
        await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [`aperture:job:${job.name}`]);
      }
      return true;
    } finally {
      client.release();
    }
  };

  const track = <T>(promise: Promise<T>) => {
    running.add(promise);
    void promise.finally(() => running.delete(promise));
    return promise;
  };

  for (const [index, job] of options.jobs.entries()) {
    // Spread first runs over a few seconds so a restart doesn't fire everything at once.
    const first = setTimeout(
      () => {
        if (!stopped)
          void track(
            runExclusive(job).catch((error: unknown) => {
              logger.error({ job: job.name, err: error }, 'job crashed');
            }),
          );
        const interval = setInterval(() => {
          if (!stopped)
            void track(
              runExclusive(job).catch((error: unknown) => {
                logger.error({ job: job.name, err: error }, 'job crashed');
              }),
            );
        }, job.everyMs);
        timers.push(interval);
      },
      1_000 + (index % 10) * 500,
    );
    timers.push(first);
  }

  return {
    async runNow(name) {
      const job = options.jobs.find((candidate) => candidate.name === name);
      if (job === undefined) throw new Error(`unknown job ${name}`);
      return track(runExclusive(job));
    },
    async stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      await Promise.allSettled([...running]);
    },
  };
}
