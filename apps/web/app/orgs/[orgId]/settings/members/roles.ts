import { ROLES, canAssignRole, type Role } from '@aperture/core';

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including granting ownership',
  admin: 'Everything except ownership',
  finance: 'Budgets, policies and the audit log',
  team_lead: 'Budgets and policies inside their team',
  member: 'Uses AI within their limits',
  auditor: 'Read-only access, including the audit log',
};

/** Roles `actor` may hand out (only owners can create owners). */
export const assignableRoles = (actor: Role): Role[] => ROLES.filter((role) => canAssignRole(actor, undefined, role));
