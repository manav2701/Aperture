import type { PolicyLayer } from '@aperture/core';
import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from './client';
import { orgs, policies, principals } from './schema';

/**
 * The active policy layers that apply to a principal (org → team → principal) and the org's
 * time zone: the input every rail's decision starts from.
 */
export async function principalPolicyContext(
  tx: DbOrTx,
  orgId: string,
  principalId: string,
): Promise<{ timezone: string; layers: PolicyLayer[] }> {
  const [org] = await tx.select({ timezone: orgs.timezone }).from(orgs).where(eq(orgs.id, orgId));
  const [principal] = await tx
    .select({ teamId: principals.teamId })
    .from(principals)
    .where(eq(principals.id, principalId));
  const scopes: { scope: 'org' | 'team' | 'principal'; id: string }[] = [
    { scope: 'org', id: orgId },
    ...(principal?.teamId == null ? [] : [{ scope: 'team' as const, id: principal.teamId }]),
    { scope: 'principal', id: principalId },
  ];
  const layers: PolicyLayer[] = [];
  for (const { scope, id } of scopes) {
    const [policy] = await tx
      .select()
      .from(policies)
      .where(and(eq(policies.orgId, orgId), eq(policies.scope, scope), eq(policies.scopeId, id)))
      .orderBy(desc(policies.version))
      .limit(1);
    if (policy) layers.push({ level: scope, scopeId: id, version: policy.version, document: policy.document });
  }
  return { timezone: org?.timezone ?? 'UTC', layers };
}
