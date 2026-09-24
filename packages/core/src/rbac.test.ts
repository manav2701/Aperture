import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, can, canAssignRole, grantFor, type Permission, type Role } from './rbac';

describe('role grants (plan/architecture §11 role table)', () => {
  const table: Record<Role, Permission[]> = {
    owner: [...PERMISSIONS],
    admin: [...PERMISSIONS],
    finance: [
      'org.read',
      'members.read',
      'teams.read',
      'budgets.read',
      'budgets.manage',
      'policies.read',
      'policies.manage',
      'principals.read',
      'audit.read',
      'audit.export',
    ],
    team_lead: [
      'org.read',
      'members.read',
      'teams.read',
      'budgets.read',
      'budgets.manage',
      'policies.read',
      'policies.manage',
      'principals.read',
    ],
    member: ['org.read', 'teams.read'],
    auditor: [
      'org.read',
      'members.read',
      'teams.read',
      'budgets.read',
      'policies.read',
      'principals.read',
      'audit.read',
      'audit.export',
    ],
  };

  it.each(ROLES)('%s has exactly the expected permissions', (role) => {
    expect(PERMISSIONS.filter((permission) => can(role, permission))).toEqual(table[role]);
  });

  it('scopes team leads to their team for management only', () => {
    expect(grantFor('team_lead', 'budgets.manage')).toBe('team');
    expect(grantFor('team_lead', 'policies.manage')).toBe('team');
    expect(grantFor('team_lead', 'budgets.read')).toBe('all');
  });

  it('keeps auditors read-only', () => {
    expect(PERMISSIONS.filter((p) => can('auditor', p) && /\.(manage|update)$/.test(p))).toEqual([]);
  });

  it('only owners grant or revoke the owner role', () => {
    expect(canAssignRole('owner', 'member', 'owner')).toBe(true);
    expect(canAssignRole('admin', 'member', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'owner', 'member')).toBe(false);
    expect(canAssignRole('admin', 'member', 'finance')).toBe(true);
    expect(canAssignRole('finance', 'member', 'auditor')).toBe(false);
  });
});
