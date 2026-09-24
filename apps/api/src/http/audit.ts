import type { JsonValue } from '@aperture/crypto';
import { appendAuditEvent, type Transaction } from '@aperture/db';

/** Records a change made by a person, in the same transaction as the change itself. */
export async function auditByUser(
  tx: Transaction,
  input: { orgId: string; userId: string; action: string; subject: string; data?: Record<string, JsonValue> },
): Promise<void> {
  await appendAuditEvent(tx, input.orgId, {
    actor: `user:${input.userId}`,
    action: input.action,
    subject: input.subject,
    data: input.data ?? {},
  });
}
