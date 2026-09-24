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
  },
  member: {
    'org.read': 'all',
    'teams.read': 'all',
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
