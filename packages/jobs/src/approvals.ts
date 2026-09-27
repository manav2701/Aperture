import { formatUsd, micros } from '@aperture/core';
import { and, eq, expireApprovals, gt, schema, sql, withSystem } from '@aperture/db';
import { queueAlert } from './alerts';
import { dbOf, type JobDeps } from './deps';

/**
 * Tells approvers about new approval requests (once each, via the alert log) and denies the
 * ones nobody decided in time (A4: silence is a no).
 */
export async function notifyApprovals(deps: JobDeps): Promise<number> {
  const pending = await withSystem(dbOf(deps), (tx) =>
    tx
      .select({ approval: schema.approvals, requester: schema.principals.name })
      .from(schema.approvals)
      .innerJoin(schema.principals, eq(schema.principals.id, schema.approvals.requesterPrincipalId))
      .where(and(eq(schema.approvals.status, 'pending'), gt(schema.approvals.expiresAt, sql`now()`)))
      .limit(200),
  );
  for (const { approval, requester } of pending) {
    await queueAlert(deps, approval.orgId, {
      dedupeKey: `approval:${approval.id}`,
      kind: 'approval_requested',
      payload: {
        approval: approval.id,
        requester,
        resource: approval.resource,
        amount: formatUsd(micros(approval.amount)),
        purpose: approval.purpose,
      },
    });
  }
  return pending.length;
}

export async function expirePendingApprovals(deps: JobDeps): Promise<number> {
  return withSystem(dbOf(deps), (tx) => expireApprovals(tx));
}
