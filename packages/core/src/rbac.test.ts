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
      'connections.read',
      'spend.read',
      'agents.read',
      'workspace.use',
      'approvals.read',
      'approvals.decide',
      'posture.read',
      'inventory.read',
      'external_spend.import',
      'attestation.create',
      'attestation.read',
      'seats.read',
      'seats.manage',
      'receipts.review',
      'tools.declare',
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
      'spend.read',
      'agents.read',
      'agents.manage',
      'workspace.use',
      'approvals.read',
      'approvals.decide',
      'posture.read',
      'inventory.read',
      'seats.read',
      'tools.declare',
    ],
    member: ['org.read', 'teams.read', 'workspace.use', 'tools.declare'],
    auditor: [
      'org.read',
      'members.read',
      'teams.read',
      'budgets.read',
      'policies.read',
      'principals.read',
      'audit.read',
      'audit.export',
      'connections.read',
      'spend.read',
      'agents.read',
      'approvals.read',
      'posture.read',
      'inventory.read',
      'attestation.read',
      'seats.read',
      'tools.declare',
    ],
  };

  it.each(ROLES)('%s has exactly the expected permissions', (role) => {
    expect(PERMISSIONS.filter((permission) => can(role, permission))).toEqual(table[role]);
  });

  it('scopes team leads to their team for management only', () => {
    expect(grantFor('team_lead', 'budgets.manage')).toBe('team');
    expect(grantFor('team_lead', 'policies.manage')).toBe('team');
    expect(grantFor('team_lead', 'agents.manage')).toBe('team');
    expect(grantFor('team_lead', 'approvals.decide')).toBe('team');
    expect(grantFor('team_lead', 'budgets.read')).toBe('all');
    expect(grantFor('team_lead', 'inventory.read')).toBe('team');
    expect(grantFor('team_lead', 'posture.read')).toBe('team');
    expect(grantFor('team_lead', 'seats.read')).toBe('team');
  });

  it('keeps auditors read-only', () => {
    expect(
      PERMISSIONS.filter((p) => can('auditor', p) && /\.(manage|update|waive|create|import|review)$/.test(p)),
    ).toEqual([]);
  });

  it('only owners grant or revoke the owner role', () => {
    expect(canAssignRole('owner', 'member', 'owner')).toBe(true);
    expect(canAssignRole('admin', 'member', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'owner', 'member')).toBe(false);
    expect(canAssignRole('admin', 'member', 'finance')).toBe(true);
    expect(canAssignRole('finance', 'member', 'auditor')).toBe(false);
  });
});
