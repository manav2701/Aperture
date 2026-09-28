import { and, appendAuditEvent, eq, inArray, isNull, lt, schema, sql, withOrg, withSystem } from '@aperture/db';
import { queueAlert } from './alerts';
import { dbOf, type JobDeps } from './deps';

/*
 * Privacy controls (plan/phases/phase-10 §10.6): each org's retention settings, applied daily,
 * and org deletion after a grace period. The ledger and the audit chain are never deleted
 * (append-only, and kept for the contractual/legal retention period).
 */

export const DELETION_GRACE_DAYS = 30;
const DEFAULT_REQUEST_LOG_DAYS = 90;
const DEFAULT_MEDIA_DAYS = 90;

export async function applyRetention(deps: JobDeps): Promise<{ requests: number; media: number }> {
  const orgs = await withSystem(dbOf(deps), (tx) =>
    tx
      .select({ id: schema.orgs.id, settings: schema.orgSettings })
      .from(schema.orgs)
      .leftJoin(schema.orgSettings, eq(schema.orgSettings.orgId, schema.orgs.id)),
  );
  const totals = { requests: 0, media: 0 };
  for (const org of orgs) {
    const requestDays = org.settings?.requestLogDays ?? DEFAULT_REQUEST_LOG_DAYS;
    const mediaDays = org.settings?.mediaDays ?? DEFAULT_MEDIA_DAYS;
    try {
      const removed = await withOrg(dbOf(deps), org.id, (tx) =>
        tx
          .delete(schema.gatewayRequests)
          .where(
            and(
              eq(schema.gatewayRequests.orgId, org.id),
              lt(schema.gatewayRequests.createdAt, sql`now() - make_interval(days => ${requestDays})`),
            ),
          )
          .returning({ id: schema.gatewayRequests.id }),
      );
      totals.requests += removed.length;

      // Media: delete the stored objects first, then the rows (finished jobs only).
      const old = await withOrg(dbOf(deps), org.id, (tx) =>
        tx
          .select()
          .from(schema.mediaJobs)
          .where(
            and(
              eq(schema.mediaJobs.orgId, org.id),
              inArray(schema.mediaJobs.status, ['succeeded', 'failed']),
              lt(schema.mediaJobs.createdAt, sql`now() - make_interval(days => ${mediaDays})`),
            ),
          )
          .limit(500),
      );
      for (const job of old) {
        if (deps.storage !== undefined) {
          for (const output of job.outputs) await deps.storage.remove(output.key);
        }
        await withOrg(dbOf(deps), org.id, (tx) => tx.delete(schema.mediaJobs).where(eq(schema.mediaJobs.id, job.id)));
        totals.media += 1;
      }
    } catch (error) {
      deps.logger.warn({ err: error, org: org.id }, 'retention failed for org');
    }
  }
  return totals;
}

/**
 * Orgs whose deletion was requested more than DELETION_GRACE_DAYS ago are shut down: keys
 * revoked, agents revoked, connections disabled, and Aperture's operators alerted to purge
 * the remaining data by hand (docs/runbooks/org-deletion.md) — deletion is irreversible, so a
 * person does the last step.
 */
export async function processDeletions(deps: JobDeps): Promise<number> {
  const due = await withSystem(dbOf(deps), (tx) =>
    tx
      .select()
      .from(schema.orgSettings)
      .where(
        and(
          eq(schema.orgSettings.deletion, 'requested'),
          lt(schema.orgSettings.deletionRequestedAt, sql`now() - make_interval(days => ${DELETION_GRACE_DAYS})`),
        ),
      ),
  );
  for (const org of due) {
    await withOrg(dbOf(deps), org.orgId, async (tx) => {
      await tx
        .update(schema.apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.apiKeys.orgId, org.orgId), isNull(schema.apiKeys.revokedAt)));
      await tx
        .update(schema.principals)
        .set({ status: 'revoked' })
        .where(and(eq(schema.principals.orgId, org.orgId), eq(schema.principals.kind, 'agent')));
      await tx.update(schema.connections).set({ status: 'disabled' }).where(eq(schema.connections.orgId, org.orgId));
      await tx
        .update(schema.orgSettings)
        .set({ deletion: 'scheduled', updatedAt: new Date() })
        .where(eq(schema.orgSettings.orgId, org.orgId));
      await appendAuditEvent(tx, org.orgId, {
        actor: 'system:privacy',
        action: 'org.deletion.scheduled',
        subject: `org:${org.orgId}`,
        data: { requestedAt: org.deletionRequestedAt?.toISOString() ?? null },
      });
    });
    await queueAlert(deps, org.orgId, {
      dedupeKey: `org-deletion:${org.orgId}`,
      kind: 'org_deletion_scheduled',
      payload: { org: org.orgId },
    });
  }
  return due.length;
}
