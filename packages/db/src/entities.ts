import { isValidTimeZone, type Period, type Rail } from '@aperture/core';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { DbOrTx } from './client';
import { budgets, orgs, principals } from './schema';

export class EntityError extends Error {
  readonly code: 'invalid_timezone' | 'not_found' | 'cross_org_reference' | 'invalid_limit';

  constructor(code: EntityError['code'], message: string) {
    super(message);
    this.name = 'EntityError';
    this.code = code;
  }
}

export async function createOrg(db: DbOrTx, input: { name: string; timezone?: string | undefined }) {
  const timezone = input.timezone ?? 'Asia/Dubai';
  if (!isValidTimeZone(timezone)) throw new EntityError('invalid_timezone', `unknown time zone "${timezone}"`);
  const [org] = await db.insert(orgs).values({ id: uuidv7(), name: input.name, timezone }).returning();
  if (!org) throw new Error('insert returned no row');
  return org;
}

export async function createPrincipal(
  db: DbOrTx,
  input: { orgId: string; kind: 'user' | 'agent'; name: string; parentPrincipalId?: string | undefined },
) {
  const [principal] = await db
    .insert(principals)
    .values({
      id: uuidv7(),
      orgId: input.orgId,
      kind: input.kind,
      name: input.name,
      parentPrincipalId: input.parentPrincipalId,
    })
    .returning();
  if (!principal) throw new Error('insert returned no row');
  return principal;
}

export interface CreateBudgetInput {
  orgId: string;
  name: string;
  parentId?: string | undefined;
  scope: 'org' | 'team' | 'principal' | 'mandate';
  scopeId?: string | undefined;
  unit?: 'micros' | 'count' | undefined;
  period: Period;
  limit: bigint;
  mode?: 'hard' | 'soft' | undefined;
  rails?: Rail[] | undefined;
  alertThresholds?: number[] | undefined;
}

export async function createBudget(db: DbOrTx, input: CreateBudgetInput) {
  if (input.limit < 0n) throw new EntityError('invalid_limit', 'limit must not be negative');
  if (input.parentId !== undefined) {
    const [parent] = await db
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.id, input.parentId), eq(budgets.orgId, input.orgId)));
    if (!parent) throw new EntityError('cross_org_reference', 'parent budget not found in this org');
  }
  const [budget] = await db
    .insert(budgets)
    .values({
      id: uuidv7(),
      orgId: input.orgId,
      parentId: input.parentId,
      name: input.name,
      scope: input.scope,
      scopeId: input.scopeId,
      unit: input.unit ?? 'micros',
      period: input.period,
      limitAmount: input.limit,
      mode: input.mode ?? 'hard',
      rails: input.rails ?? [],
      alertThresholds: input.alertThresholds ?? [],
    })
    .returning();
  if (!budget) throw new Error('insert returned no row');
  return budget;
}

/** L9: lowering a limit below current spend is allowed; new reserves are then denied. */
export async function setBudgetLimit(db: DbOrTx, input: { orgId: string; budgetId: string; limit: bigint }) {
  if (input.limit < 0n) throw new EntityError('invalid_limit', 'limit must not be negative');
  const updated = await db
    .update(budgets)
    .set({ limitAmount: input.limit })
    .where(and(eq(budgets.id, input.budgetId), eq(budgets.orgId, input.orgId)))
    .returning({ id: budgets.id });
  if (updated.length === 0) throw new EntityError('not_found', 'budget not found');
}
