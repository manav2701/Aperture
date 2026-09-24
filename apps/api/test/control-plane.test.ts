import { ROLES, can, type Role } from '@aperture/core';
import { verifyChain, type ChainRecord } from '@aperture/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, createHarness, createOrg, invitationToken, joinAs, signUp, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

let emailCounter = 0;
const uniqueEmail = (label: string) => `${label}-${String((emailCounter += 1))}@example.com`;

const post = (path: string, cookie: string, payload: unknown) =>
  h.request(path, { method: 'POST', cookie, body: JSON.stringify(payload) });
const patch = (path: string, cookie: string, payload: unknown) =>
  h.request(path, { method: 'PATCH', cookie, body: JSON.stringify(payload) });
const put = (path: string, cookie: string, payload: unknown) =>
  h.request(path, { method: 'PUT', cookie, body: JSON.stringify(payload) });

async function newOrg(label = 'owner') {
  const owner = await signUp(h, uniqueEmail(label));
  const orgId = await createOrg(h, owner);
  return { owner, orgId, base: `/api/v1/orgs/${orgId}` };
}

interface Member {
  id: string;
  email: string;
  role: Role;
}
interface Budget {
  id: string;
  name: string;
  limit: string;
  usage: { spent: string; held: string };
}

describe('route registry', () => {
  it('guards every org-scoped route with a permission and keeps public routes to a known list', () => {
    const publicRoutes = h.routes.filter((r) => r.access === 'public').map((r) => `${r.method} ${r.path}`);
    expect(publicRoutes).toEqual(['GET /api/v1/invitations/{token}']);
    for (const route of h.routes) {
      if (route.path.includes('{orgId}')) expect(typeof route.access, `${route.method} ${route.path}`).toBe('object');
    }
  });

  it('documents every registered route in the OpenAPI document', async () => {
    const doc = await body<{ paths: Record<string, Record<string, unknown>> }>(await h.request('/api/v1/openapi.json'));
    for (const route of h.routes) {
      expect(doc.paths[route.path]?.[route.method.toLowerCase()], `${route.method} ${route.path}`).toBeDefined();
    }
    // The committed copy for readers and client generators; refresh with `pnpm --filter @aperture/api test -u`.
    await expect(`${JSON.stringify(doc, null, 2)}\n`).toMatchFileSnapshot('../../../docs/api/openapi.json');
  });
});

describe('tenancy', () => {
  it('hides other organizations entirely (404, not 403)', async () => {
    const a = await newOrg();
    const b = await newOrg();
    for (const path of ['', '/members', '/budgets', '/policies', '/audit']) {
      expect((await h.request(`${b.base}${path}`, { cookie: a.owner })).status, path).toBe(404);
    }
    expect((await h.request('/api/v1/orgs/not-a-uuid', { cookie: a.owner })).status).toBe(404);
  });
});

describe('roles', () => {
  const probes = [
    { permission: 'members.read', call: (base: string, cookie: string) => h.request(`${base}/members`, { cookie }) },
    { permission: 'audit.read', call: (base: string, cookie: string) => h.request(`${base}/audit`, { cookie }) },
    {
      permission: 'teams.manage',
      call: (base: string, cookie: string) => post(`${base}/teams`, cookie, { name: uniqueEmail('team') }),
    },
    { permission: 'org.update', call: (base: string, cookie: string) => patch(base, cookie, { name: 'Renamed' }) },
  ] as const;

  it.each(ROLES.filter((role) => role !== 'owner'))('enforces the permission matrix for %s', async (role) => {
    const { owner, orgId, base } = await newOrg();
    const cookie = await joinAs(h, { ownerCookie: owner, orgId, email: uniqueEmail(role), role });
    for (const probe of probes) {
      const response = await probe.call(base, cookie);
      if (can(role, probe.permission)) expect(response.status, probe.permission).toBeLessThan(300);
      else expect(response.status, probe.permission).toBe(403);
    }
  });

  it('only lets owners grant ownership, and never removes the last owner', async () => {
    const { owner, orgId, base } = await newOrg();
    const admin = await joinAs(h, { ownerCookie: owner, orgId, email: uniqueEmail('admin'), role: 'admin' });
    const { members } = await body<{ members: Member[] }>(await h.request(`${base}/members`, { cookie: owner }));
    const ownerMember = members.find((m) => m.role === 'owner');
    const adminMember = members.find((m) => m.role === 'admin');
    if (!ownerMember || !adminMember) throw new Error('members missing');

    expect((await patch(`${base}/members/${adminMember.id}`, admin, { role: 'owner' })).status).toBe(403);
    expect((await post(`${base}/invitations`, admin, { email: uniqueEmail('x'), role: 'owner' })).status).toBe(403);
    expect((await h.request(`${base}/members/${ownerMember.id}`, { method: 'DELETE', cookie: admin })).status).toBe(
      403,
    );
    expect((await patch(`${base}/members/${ownerMember.id}`, owner, { role: 'admin' })).status).toBe(409);

    expect((await patch(`${base}/members/${adminMember.id}`, owner, { role: 'owner' })).status).toBe(200);
    expect((await patch(`${base}/members/${ownerMember.id}`, owner, { role: 'admin' })).status).toBe(200);
  });

  it('revokes the principal of a removed member', async () => {
    const { owner, orgId, base } = await newOrg();
    const email = uniqueEmail('leaver');
    const leaver = await joinAs(h, { ownerCookie: owner, orgId, email, role: 'member' });
    const { members } = await body<{ members: Member[] }>(await h.request(`${base}/members`, { cookie: owner }));
    const target = members.find((m) => m.email === email);
    if (!target) throw new Error('member missing');
    expect((await h.request(`${base}/members/${target.id}`, { method: 'DELETE', cookie: owner })).status).toBe(204);

    const { principals } = await body<{ principals: { name: string; status: string }[] }>(
      await h.request(`${base}/principals`, { cookie: owner }),
    );
    expect(principals.find((p) => p.name === email.split('@')[0])?.status).toBe('revoked');
    expect((await h.request(base, { cookie: leaver })).status).toBe(404);
  });
});

describe('invitations', () => {
  it('can only be accepted by the invited, verified email, once', async () => {
    const { owner, base } = await newOrg();
    const email = uniqueEmail('invitee');
    expect((await post(`${base}/invitations`, owner, { email, role: 'finance' })).status).toBe(201);
    const token = invitationToken(h, email);

    const preview = await body<{ status: string; role: string }>(await h.request(`/api/v1/invitations/${token}`));
    expect(preview).toMatchObject({ status: 'pending', role: 'finance' });

    const stranger = await signUp(h, uniqueEmail('stranger'));
    expect((await post('/api/v1/invitations/accept', stranger, { token })).status).toBe(403);

    const invitee = await signUp(h, email);
    expect((await post('/api/v1/invitations/accept', invitee, { token })).status).toBe(200);
    expect((await post('/api/v1/invitations/accept', invitee, { token })).status).toBe(200);
    expect((await post('/api/v1/invitations/accept', stranger, { token })).status).toBe(409);
    expect((await body<{ status: string }>(await h.request(`/api/v1/invitations/${token}`))).status).toBe('accepted');
  });

  it('stops working once revoked', async () => {
    const { owner, base } = await newOrg();
    const email = uniqueEmail('revoked');
    const created = await body<{ id: string }>(await post(`${base}/invitations`, owner, { email, role: 'member' }));
    const token = invitationToken(h, email);
    expect((await h.request(`${base}/invitations/${created.id}`, { method: 'DELETE', cookie: owner })).status).toBe(
      204,
    );
    const invitee = await signUp(h, email);
    expect((await post('/api/v1/invitations/accept', invitee, { token })).status).toBe(404);
  });
});

describe('budgets', () => {
  it('scopes team leads to their team’s subtree', async () => {
    const { owner, orgId, base } = await newOrg();
    const team = await body<{ id: string }>(await post(`${base}/teams`, owner, { name: 'Research' }));
    const other = await body<{ id: string }>(await post(`${base}/teams`, owner, { name: 'Sales' }));
    const lead = await joinAs(h, {
      ownerCookie: owner,
      orgId,
      email: uniqueEmail('lead'),
      role: 'team_lead',
      teamId: team.id,
    });

    const orgBudget = await body<Budget>(
      await post(`${base}/budgets`, owner, { name: 'Company', scope: 'org', period: 'month', limit: '1000' }),
    );
    const mine = await body<Budget>(
      await post(`${base}/budgets`, owner, {
        name: 'Research',
        parentId: orgBudget.id,
        scope: 'team',
        scopeId: team.id,
        period: 'month',
        limit: '400',
      }),
    );
    const theirs = await body<Budget>(
      await post(`${base}/budgets`, owner, {
        name: 'Sales',
        parentId: orgBudget.id,
        scope: 'team',
        scopeId: other.id,
        period: 'month',
        limit: '300',
      }),
    );
    expect(orgBudget.limit).toBe('1000.00');

    const child = await post(`${base}/budgets`, lead, {
      name: 'Experiments',
      parentId: mine.id,
      scope: 'team',
      scopeId: team.id,
      period: 'day',
      limit: '25.50',
    });
    expect(child.status).toBe(201);
    const created = await body<Budget>(child);
    expect(created).toMatchObject({ limit: '25.50', usage: { spent: '0.00', held: '0.00' } });

    expect((await patch(`${base}/budgets/${created.id}`, lead, { limit: '30' })).status).toBe(200);
    expect((await patch(`${base}/budgets/${mine.id}`, lead, { limit: '10000' })).status).toBe(403);
    expect((await patch(`${base}/budgets/${theirs.id}`, lead, { limit: '1' })).status).toBe(403);
    expect(
      (
        await post(`${base}/budgets`, lead, {
          name: 'x',
          parentId: theirs.id,
          scope: 'team',
          scopeId: other.id,
          period: 'day',
          limit: '1',
        })
      ).status,
    ).toBe(403);
    expect((await patch(`${base}/budgets/${mine.id}`, owner, { archived: true })).status).toBe(409);
  });

  it('rejects malformed limits', async () => {
    const { owner, base } = await newOrg();
    for (const limit of ['-1', '1.1234567', 'ten', '']) {
      const response = await post(`${base}/budgets`, owner, { name: 'b', scope: 'org', period: 'month', limit });
      expect(response.status, limit).toBe(400);
    }
  });
});

describe('policies', () => {
  const denyVideo = { rules: [{ id: 'no-video', type: 'deny_providers', providers: ['runway'] }] };

  it('publishes immutable versions and detects concurrent edits', async () => {
    const { owner, orgId, base } = await newOrg();
    const path = `${base}/policies/org/${orgId}`;
    expect((await put(path, owner, { document: { rules: [{ id: 'x', type: 'nope' }] } })).status).toBe(400);
    expect((await put(path, owner, { document: denyVideo, expectedVersion: 0 })).status).toBe(200);
    expect((await put(path, owner, { document: { rules: [] }, expectedVersion: 0 })).status).toBe(409);
    expect((await put(path, owner, { document: { rules: [] }, expectedVersion: 1 })).status).toBe(200);

    const history = await body<{ active: { version: number }; versions: { version: number }[] }>(
      await h.request(path, { cookie: owner }),
    );
    expect(history.active.version).toBe(2);
    expect(history.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('simulates decisions against active policies and drafts', async () => {
    const { owner, orgId, base } = await newOrg();
    await put(`${base}/policies/org/${orgId}`, owner, { document: denyVideo });
    const action = { rail: 'provider', amount: '2.00', provider: 'runway', model: 'gen-4' };

    const active = await body<{ outcome: string; reasons: { code: string }[] }>(
      await post(`${base}/policies/simulate`, owner, { action }),
    );
    expect(active.outcome).toBe('deny');
    expect(active.reasons[0]?.code).toBe('provider_denied');

    const draft = await body<{ outcome: string }>(
      await post(`${base}/policies/simulate`, owner, {
        action,
        drafts: [{ scope: 'org', scopeId: orgId, document: { rules: [] } }],
      }),
    );
    expect(draft.outcome).toBe('allow');
  });

  it('keeps team leads out of the org policy and other teams', async () => {
    const { owner, orgId, base } = await newOrg();
    const team = await body<{ id: string }>(await post(`${base}/teams`, owner, { name: 'Research' }));
    const other = await body<{ id: string }>(await post(`${base}/teams`, owner, { name: 'Sales' }));
    const lead = await joinAs(h, {
      ownerCookie: owner,
      orgId,
      email: uniqueEmail('lead'),
      role: 'team_lead',
      teamId: team.id,
    });
    expect((await put(`${base}/policies/team/${team.id}`, lead, { document: denyVideo })).status).toBe(200);
    expect((await put(`${base}/policies/team/${other.id}`, lead, { document: denyVideo })).status).toBe(403);
    expect((await put(`${base}/policies/org/${orgId}`, lead, { document: denyVideo })).status).toBe(403);
  });
});

describe('audit', () => {
  it('records every change in a chain that verifies and exports', async () => {
    const { owner, base } = await newOrg();
    await post(`${base}/teams`, owner, { name: 'Ops' });
    await post(`${base}/budgets`, owner, { name: 'Company', scope: 'org', period: 'month', limit: '100' });

    const page = await body<{ events: { seq: number; action: string }[] }>(
      await h.request(`${base}/audit`, { cookie: owner }),
    );
    expect(page.events.map((e) => e.action)).toEqual(['budget.created', 'team.created', 'org.created']);

    const verified = await body<{ ok: boolean; records: number; root: string }>(
      await h.request(`${base}/audit/verify`, { cookie: owner }),
    );
    expect(verified).toMatchObject({ ok: true, records: 3 });

    const exported = await h.request(`${base}/audit/export`, { cookie: owner });
    expect(exported.headers.get('content-type')).toContain('application/x-ndjson');
    const records = (await exported.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as ChainRecord);
    expect(records).toHaveLength(3);
    expect(verifyChain(records).ok).toBe(true);

    // The export itself is audited.
    const after = await body<{ events: { action: string }[] }>(
      await h.request(`${base}/audit?limit=1`, { cookie: owner }),
    );
    expect(after.events[0]?.action).toBe('audit.exported');
  });
});
