import type { Rail } from './rails';

/*
 * Aperture's own plans (plan/phases/phase-10 §10.7; prices are the vision doc's hypothesis to
 * validate with pilots). Limits are what the API enforces when billing is on; self-hosted and
 * pilot orgs are unlimited.
 */

export type Plan = 'pilot' | 'free' | 'team' | 'business';

export interface PlanLimits {
  members: number | null;
  agents: number | null;
  connections: number | null;
  rails: readonly Rail[];
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  pilot: { members: null, agents: null, connections: null, rails: ['gateway', 'provider', 'card', 'x402'] },
  free: { members: 3, agents: 2, connections: 1, rails: ['gateway', 'provider'] },
  team: { members: 25, agents: 25, connections: 10, rails: ['gateway', 'provider', 'card'] },
  business: { members: null, agents: null, connections: null, rails: ['gateway', 'provider', 'card', 'x402'] },
};

export const PLAN_LABELS: Record<Plan, string> = {
  pilot: 'Pilot',
  free: 'Free',
  team: 'Team — USD 49 / month',
  business: 'Business — USD 499 / month',
};

export type PlanResource = 'members' | 'agents' | 'connections';

/** undefined = allowed; otherwise the message to show. */
export function planLimitReason(plan: Plan, resource: PlanResource, current: number): string | undefined {
  const limit = PLAN_LIMITS[plan][resource];
  if (limit === null || current < limit) return undefined;
  return `the ${PLAN_LABELS[plan].split(' —')[0] ?? plan} plan includes ${String(limit)} ${resource}; upgrade in Settings → Billing`;
}
