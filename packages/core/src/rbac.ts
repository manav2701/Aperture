/**
 * Roles and permissions for people in an org (plan/architecture §11). Agents are principals
 * too, but they authenticate with Aperture keys on the data plane and never get these.
 */
export const ROLES = ['owner', 'admin', 'finance', 'team_lead', 'member', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'org.read',
  'org.update',
  'members.read',
  'members.manage',
  'teams.read',
  'teams.manage',
  'budgets.read',
  'budgets.manage',
  'policies.read',
  'policies.manage',
  'principals.read',
  'audit.read',
  'audit.export',
  'connections.read',
  'connections.manage',
  'spend.read',
  'agents.read',
  'agents.manage',
  /** Use the workspace chat and hold personal gateway keys. */
  'workspace.use',
  'approvals.read',
  /** Approve or deny requests (never your own, or your own agents'). */
  'approvals.decide',
  /** Governance posture (Phase 11): read checks and results; waive a failing check. */
  'posture.read',
  'posture.waive',
  /** The AI inventory and its governance coverage figure. */
  'inventory.read',
  /** Upload bank or card statements to find AI spend Aperture doesn't govern. */
  'external_spend.import',
  'attestation.create',
  'attestation.read',
  /** Seats and subscriptions (Phase 12). */
  'seats.read',
  'seats.manage',
  /** Review receipts the inbox couldn't import on its own. */
  'receipts.review',
  /** Declare your own AI tools, forward receipts, and connect your terminal tools. */
  'tools.declare',
  /** See and revoke every member's telemetry tokens. */
  'telemetry.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * `team` means the permission only applies inside the member's own team: its budget subtree,
 * its team policy, and the policies of principals in the team.
 */
export type Grant = 'all' | 'team';

const everything = Object.fromEntries(PERMISSIONS.map((permission) => [permission, 'all'])) as Record<
  Permission,
  Grant
>;

export const ROLE_GRANTS: Record<Role, Partial<Record<Permission, Grant>>> = {
  owner: everything,
  admin: everything,
  finance: {
    'org.read': 'all',
    'members.read': 'all',
    'teams.read': 'all',
    'budgets.read': 'all',
    'budgets.manage': 'all',
    'policies.read': 'all',
    'policies.manage': 'all',
    'principals.read': 'all',
    'audit.read': 'all',
    'audit.export': 'all',
    'connections.read': 'all',
    'spend.read': 'all',
    'agents.read': 'all',
    'workspace.use': 'all',
    'approvals.read': 'all',
    'approvals.decide': 'all',
    'posture.read': 'all',
    'inventory.read': 'all',
    'external_spend.import': 'all',
    'attestation.create': 'all',
    'attestation.read': 'all',
    'seats.read': 'all',
    'seats.manage': 'all',
    'receipts.review': 'all',
    'tools.declare': 'all',
  },
  team_lead: {
    'org.read': 'all',
    'members.read': 'all',
    'teams.read': 'all',
    'budgets.read': 'all',
    'budgets.manage': 'team',
    'policies.read': 'all',
    'policies.manage': 'team',
    'principals.read': 'all',
    'spend.read': 'all',
    'agents.read': 'all',
    'agents.manage': 'team',
    'workspace.use': 'all',
    'approvals.read': 'all',
    'approvals.decide': 'team',
    'posture.read': 'team',
    'inventory.read': 'team',
    'seats.read': 'team',
    'tools.declare': 'all',
  },
  member: {
    'org.read': 'all',
    'teams.read': 'all',
    'workspace.use': 'all',
    'tools.declare': 'all',
  },
  auditor: {
    'org.read': 'all',
    'members.read': 'all',
    'teams.read': 'all',
    'budgets.read': 'all',
    'policies.read': 'all',
    'principals.read': 'all',
    'audit.read': 'all',
    'audit.export': 'all',
    'connections.read': 'all',
    'spend.read': 'all',
    'agents.read': 'all',
    'approvals.read': 'all',
    'posture.read': 'all',
    'inventory.read': 'all',
    'attestation.read': 'all',
    'seats.read': 'all',
    'tools.declare': 'all',
  },
};

export function grantFor(role: Role, permission: Permission): Grant | undefined {
  return ROLE_GRANTS[role][permission];
}

export function can(role: Role, permission: Permission): boolean {
  return grantFor(role, permission) !== undefined;
}

/** Only owners may make someone an owner or change an owner's role (and never the last one). */
export function canAssignRole(actor: Role, from: Role | undefined, to: Role): boolean {
  if (!can(actor, 'members.manage')) return false;
  if (to === 'owner' || from === 'owner') return actor === 'owner';
  return true;
}
