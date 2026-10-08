import { evaluatePosture, newFailures, type CheckResult, type PostureResult } from '@aperture/core';
import { and, collectPostureSnapshot, desc, eq, gt, isNull, lt, schema, sql, withOrg, withSystem } from '@aperture/db';
import { v7 as uuidv7 } from 'uuid';
import { queueAlert } from './alerts';
import { dbOf, type JobDeps } from './deps';

/*
 * The posture run (plan/phases/phase-11 §11.2): snapshot → evaluate → store, daily for every org
 * and on demand. The audit chain is verified incrementally from the previous run's checkpoint
 * (V15). Regression alerts fire only for critical or high failures that weren't failing before.
 */

/** Providers whose connectors can disable or delete keys Aperture didn't create (tier T2). */
export const REVOCABLE_PROVIDERS = ['openrouter', 'openai', 'anthropic'] as const;

export interface PostureRun {
  id: string;
  ranAt: Date;
  result: PostureResult;
  previous: CheckResult[] | undefined;
}

export async function runPosture(
  deps: JobDeps,
  orgId: string,
  trigger: 'scheduled' | 'manual' | 'attestation',
): Promise<PostureRun> {
  return withOrg(dbOf(deps), orgId, async (tx) => {
    const [last] = await tx
      .select()
      .from(schema.postureRuns)
      .where(eq(schema.postureRuns.orgId, orgId))
      .orderBy(desc(schema.postureRuns.ranAt))
      .limit(1);
    const checkpoint =
      last?.auditVerifiedSeq != null && last.auditVerifiedHash != null
        ? { seq: last.auditVerifiedSeq, hash: last.auditVerifiedHash }
        : null;
    const { snapshot, auditCheckpoint } = await collectPostureSnapshot(tx, orgId, {
      verifyAudit: { from: checkpoint },
      checkLedger: true,
      anchoringEnabled: deps.notarySecret !== undefined,
      revocableProviders: REVOCABLE_PROVIDERS,
    });
    const now = new Date(snapshot.takenAt);
    const waivers = await tx
      .select()
      .from(schema.postureWaivers)
      .where(
        and(
          eq(schema.postureWaivers.orgId, orgId),
          isNull(schema.postureWaivers.revokedAt),
          gt(schema.postureWaivers.expiresAt, now),
        ),
      );
    const result = evaluatePosture(snapshot, {
      now,
      waivers: waivers.map((w) => ({
        checkId: w.checkId,
        subjectId: w.subjectId,
        expiresAt: w.expiresAt.toISOString(),
      })),
    });
    const id = uuidv7();
    await tx.insert(schema.postureRuns).values({
      id,
      orgId,
      catalogueVersion: result.catalogueVersion,
      trigger,
      score: result.score,
      grade: result.grade,
      results: result.results,
      auditVerifiedSeq: auditCheckpoint?.seq ?? null,
      auditVerifiedHash: auditCheckpoint?.hash ?? null,
      ranAt: now,
    });
    return { id, ranAt: now, result, previous: last?.results as CheckResult[] | undefined };
  });
}

/** Daily: a run for every org, regression alerts, and warnings for waivers about to expire. */
export async function runAllPosture(deps: JobDeps): Promise<number> {
  const orgs = await withSystem(dbOf(deps), (tx) =>
    tx
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .leftJoin(schema.orgSettings, eq(schema.orgSettings.orgId, schema.orgs.id))
      .where(sql`coalesce(${schema.orgSettings.deletion}, 'none') = 'none'`),
  );
  let ran = 0;
  for (const org of orgs) {
    try {
      const run = await runPosture(deps, org.id, 'scheduled');
      ran += 1;
      const day = run.ranAt.toISOString().slice(0, 10);
      for (const failure of newFailures(run.previous, run.result.results)) {
        if (failure.severity !== 'critical' && failure.severity !== 'high') continue;
        await queueAlert(deps, org.id, {
          dedupeKey: `posture:${failure.id}:${day}`,
          kind: 'posture_regression',
          payload: {
            check: failure.id,
            title: failure.title,
            severity: failure.severity,
            subjects: failure.subjects.length,
          },
        });
      }
      await warnExpiringWaivers(deps, org.id, run.ranAt);
    } catch (error) {
      deps.logger.warn({ err: error, org: org.id }, 'posture run failed for org');
    }
  }
  return ran;
}

async function warnExpiringWaivers(deps: JobDeps, orgId: string, now: Date): Promise<void> {
  const soon = await withOrg(dbOf(deps), orgId, (tx) =>
    tx
      .select()
      .from(schema.postureWaivers)
      .where(
        and(
          eq(schema.postureWaivers.orgId, orgId),
          isNull(schema.postureWaivers.revokedAt),
          gt(schema.postureWaivers.expiresAt, now),
          lt(schema.postureWaivers.expiresAt, new Date(now.getTime() + 7 * 86_400_000)),
        ),
      ),
  );
  for (const waiver of soon)
    await queueAlert(deps, orgId, {
      dedupeKey: `waiver:${waiver.id}`,
      kind: 'waiver_expiring',
      payload: { check: waiver.checkId, expires: waiver.expiresAt.toISOString().slice(0, 10), reason: waiver.reason },
    });
}
