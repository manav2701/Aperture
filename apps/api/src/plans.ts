import { planLimitReason, type Plan, type PlanResource } from '@aperture/core';
import { and, count, eq, isNull, ne, notInArray, schema, type Transaction } from '@aperture/db';
import type { AppDeps } from './http/context';
import { AppError } from './http/errors';

/*
 * Plan limits (plan/phases/phase-10 §10.7). Only enforced when Aperture's own billing is
 * configured; self-hosted installs have no limits. A pilot is unlimited until its end date.
 */

export async function effectivePlan(tx: Transaction, orgId: string): Promise<Plan> {
  const [row] = await tx.select().from(schema.orgBilling).where(eq(schema.orgBilling.orgId, orgId));
  if (row === undefined) return 'free';
  if (row.plan === 'pilot')
    return row.pilotEndsAt !== null && row.pilotEndsAt.getTime() < Date.now() ? 'free' : 'pilot';
  if (row.plan !== 'free' && row.status !== null && !['active', 'trialing', 'past_due'].includes(row.status))
    return 'free';
  return row.plan;
}

export async function usageOf(tx: Transaction, orgId: string): Promise<Record<PlanResource, number>> {
  const [members] = await tx.select({ n: count() }).from(schema.members).where(eq(schema.members.orgId, orgId));
  const [agents] = await tx
    .select({ n: count() })
    .from(schema.principals)
    .where(
      and(
        eq(schema.principals.orgId, orgId),
        eq(schema.principals.kind, 'agent'),
        ne(schema.principals.status, 'revoked'),
        isNull(schema.principals.systemRole),
        isNull(schema.principals.parentPrincipalId),
      ),
    );
  const [connections] = await tx
    .select({ n: count() })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.orgId, orgId),
        eq(schema.connections.status, 'active'),
        notInArray(schema.connections.provider, ['slack', 'slack_app']),
      ),
    );
  return { members: members?.n ?? 0, agents: agents?.n ?? 0, connections: connections?.n ?? 0 };
}

export async function assertWithinPlan(deps: AppDeps, tx: Transaction, orgId: string, resource: PlanResource) {
  if (deps.billing === undefined) return;
  const plan = await effectivePlan(tx, orgId);
  const usage = await usageOf(tx, orgId);
  const reason = planLimitReason(plan, resource, usage[resource]);
  if (reason !== undefined) throw new AppError(402, 'plan_limit', reason);
}
