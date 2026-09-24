import { grantFor, type Permission } from '@aperture/core';
import type { Membership } from './context';
import { forbidden } from './errors';

/**
 * How far a member's permission reaches: `{ kind: 'all' }` for the whole org, or a single team
 * for team-scoped grants (team leads). A team-scoped grant with no team reaches nothing.
 */
export type Reach = { kind: 'all' } | { kind: 'team'; teamId: string };

export function reachOf(membership: Membership, permission: Permission): Reach {
  const grant = grantFor(membership.role, permission);
  if (grant === 'all') return { kind: 'all' };
  if (grant === 'team' && membership.teamId !== null) return { kind: 'team', teamId: membership.teamId };
  throw forbidden();
}
