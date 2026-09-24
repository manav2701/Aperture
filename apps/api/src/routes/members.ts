import { createHash, randomBytes } from 'node:crypto';
import { canAssignRole } from '@aperture/core';
import { and, count, eq, gt, isNull, schema, withOrg, withSystem, type Transaction } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { emails } from '../email';
import { AppError, forbidden, notFound } from '../http/errors';
import { OrgParams, RoleSchema, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MemberSchema = z
  .object({
    id: z.uuid(),
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    role: RoleSchema,
    teamId: z.uuid().nullable(),
    createdAt: Timestamp,
  })
  .openapi('Member');

const InvitationSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    role: RoleSchema,
    teamId: z.uuid().nullable(),
    expiresAt: Timestamp,
    createdAt: Timestamp,
  })
  .openapi('Invitation');

const MemberParams = OrgParams.extend({ memberId: z.uuid().openapi({ param: { name: 'memberId', in: 'path' } }) });
const InvitationParams = OrgParams.extend({
  invitationId: z.uuid().openapi({ param: { name: 'invitationId', in: 'path' } }),
});
const TokenParams = z.object({
  token: z
    .string()
    .min(20)
    .max(200)
    .openapi({ param: { name: 'token', in: 'path' } }),
});

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

async function listMembers(tx: Transaction, orgId: string) {
  const rows = await tx
    .select({
      id: schema.members.id,
      userId: schema.members.userId,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.members.role,
      teamId: schema.members.teamId,
      createdAt: schema.members.createdAt,
    })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(eq(schema.members.orgId, orgId))
    .orderBy(schema.users.name);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

async function ownerCount(tx: Transaction, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(schema.members)
    .where(and(eq(schema.members.orgId, orgId), eq(schema.members.role, 'owner')));
  return row?.n ?? 0;
}

async function assertActiveTeam(tx: Transaction, orgId: string, teamId: string | null | undefined) {
  if (teamId === null || teamId === undefined) return;
  const [team] = await tx
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(and(eq(schema.teams.id, teamId), eq(schema.teams.orgId, orgId), isNull(schema.teams.archivedAt)));
  if (!team) throw new AppError(400, 'invalid_team', 'that team does not exist in this organization');
}

/** Gives a person a principal in the org (or re-activates the one they had). */
async function ensureUserPrincipal(
  tx: Transaction,
  input: { orgId: string; userId: string; name: string; teamId: string | null },
) {
  const [existing] = await tx
    .select({ id: schema.principals.id })
    .from(schema.principals)
    .where(and(eq(schema.principals.orgId, input.orgId), eq(schema.principals.userId, input.userId)));
  if (existing) {
    await tx
      .update(schema.principals)
      .set({ status: 'active', teamId: input.teamId })
      .where(eq(schema.principals.id, existing.id));
    return;
  }
  await tx.insert(schema.principals).values({
    id: uuidv7(),
    orgId: input.orgId,
    kind: 'user',
    name: input.name,
    userId: input.userId,
    teamId: input.teamId,
  });
}

export function registerMemberRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'members.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/members',
      tags: ['members'],
      request: { params: OrgParams },
      responses: { 200: json(z.object({ members: z.array(MemberSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const members = await withOrg(deps.db, orgId, (tx) => listMembers(tx, orgId));
      return c.json({ members }, 200);
    },
  );

  router.add(
    { permission: 'members.manage' },
    createRoute({
      method: 'patch',
      path: '/api/v1/orgs/{orgId}/members/{memberId}',
      tags: ['members'],
      summary: 'Change a member’s role or team',
      request: {
        params: MemberParams,
        ...jsonBody(z.object({ role: RoleSchema.optional(), teamId: z.uuid().nullable().optional() })),
      },
      responses: { 200: json(MemberSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const actor = c.var.membership;
      const { orgId, memberId } = c.req.valid('param');
      const body = c.req.valid('json');
      const member = await withOrg(deps.db, orgId, async (tx) => {
        const [target] = await tx
          .select()
          .from(schema.members)
          .where(and(eq(schema.members.id, memberId), eq(schema.members.orgId, orgId)))
          .for('update');
        if (!target) throw notFound('member');
        const from = target.role;
        if (body.role !== undefined && body.role !== from) {
          if (!canAssignRole(actor.role, from, body.role))
            throw forbidden('only owners can grant or remove the owner role');
          if (from === 'owner' && (await ownerCount(tx, orgId)) <= 1) {
            throw new AppError(409, 'last_owner', 'an organization needs at least one owner');
          }
        }
        await assertActiveTeam(tx, orgId, body.teamId);
        const changes = {
          ...(body.role === undefined ? {} : { role: body.role }),
          ...(body.teamId === undefined ? {} : { teamId: body.teamId }),
        };
        await tx.update(schema.members).set(changes).where(eq(schema.members.id, memberId));
        if (body.teamId !== undefined) {
          await tx
            .update(schema.principals)
            .set({ teamId: body.teamId })
            .where(and(eq(schema.principals.orgId, orgId), eq(schema.principals.userId, target.userId)));
        }
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'member.updated',
          subject: `member:${memberId}`,
          data: { ...changes, previousRole: from },
        });
        const updated = (await listMembers(tx, orgId)).find((m) => m.id === memberId);
        if (!updated) throw notFound('member');
        return updated;
      });
      return c.json(member, 200);
    },
  );

  router.add(
    { permission: 'members.manage' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/members/{memberId}',
      tags: ['members'],
      summary: 'Remove a member; their principal is revoked so it can’t spend',
      request: { params: MemberParams },
      responses: { 204: { description: 'Removed' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const actor = c.var.membership;
      const { orgId, memberId } = c.req.valid('param');
      await withOrg(deps.db, orgId, async (tx) => {
        const [target] = await tx
          .select()
          .from(schema.members)
          .where(and(eq(schema.members.id, memberId), eq(schema.members.orgId, orgId)))
          .for('update');
        if (!target) throw notFound('member');
        if (target.role === 'owner') {
          if (actor.role !== 'owner') throw forbidden('only owners can remove an owner');
          if ((await ownerCount(tx, orgId)) <= 1) {
            throw new AppError(409, 'last_owner', 'an organization needs at least one owner');
          }
        }
        await tx
          .update(schema.principals)
          .set({ status: 'revoked' })
          .where(and(eq(schema.principals.orgId, orgId), eq(schema.principals.userId, target.userId)));
        await tx.delete(schema.members).where(eq(schema.members.id, memberId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'member.removed',
          subject: `member:${memberId}`,
          data: { userId: target.userId, role: target.role },
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'members.manage' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/invitations',
      tags: ['invitations'],
      summary: 'Pending invitations',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ invitations: z.array(InvitationSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.invitations)
          .where(
            and(
              eq(schema.invitations.orgId, orgId),
              isNull(schema.invitations.acceptedAt),
              isNull(schema.invitations.revokedAt),
              gt(schema.invitations.expiresAt, new Date()),
            ),
          )
          .orderBy(schema.invitations.createdAt),
      );
      return c.json(
        {
          invitations: rows.map((row) => ({
            id: row.id,
            email: row.email,
            role: row.role,
            teamId: row.teamId,
            expiresAt: row.expiresAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'members.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/invitations',
      tags: ['invitations'],
      summary: 'Invite someone by email',
      request: {
        params: OrgParams,
        ...jsonBody(z.object({ email: z.email().max(254), role: RoleSchema, teamId: z.uuid().nullable().optional() })),
      },
      responses: { 201: json(InvitationSchema, 'Created'), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const actor = c.var.membership;
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const email = body.email.toLowerCase();
      if (!canAssignRole(actor.role, undefined, body.role)) throw forbidden('only owners can invite owners');

      const token = randomBytes(32).toString('base64url');
      const { invitation, orgName } = await withOrg(deps.db, orgId, async (tx) => {
        await assertActiveTeam(tx, orgId, body.teamId);
        const [alreadyMember] = await tx
          .select({ id: schema.members.id })
          .from(schema.members)
          .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(and(eq(schema.members.orgId, orgId), eq(schema.users.email, email)));
        if (alreadyMember) throw new AppError(409, 'already_member', 'that person is already a member');
        const [org] = await tx.select({ name: schema.orgs.name }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
        const [created] = await tx
          .insert(schema.invitations)
          .values({
            id: uuidv7(),
            orgId,
            email,
            role: body.role,
            teamId: body.teamId ?? null,
            tokenHash: hashToken(token),
            invitedBy: user.id,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          })
          .returning();
        if (!created) throw new Error('insert returned no row');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'invitation.created',
          subject: `invitation:${created.id}`,
          data: { email, role: body.role },
        });
        return { invitation: created, orgName: org?.name ?? 'an organization' };
      });

      await deps.email.send({
        to: email,
        ...emails.invitation({
          orgName,
          inviterName: user.name,
          role: body.role,
          url: `${deps.webOrigin}/invite/${token}`,
        }),
      });
      return c.json(
        {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          teamId: invitation.teamId,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        },
        201,
      );
    },
  );

  router.add(
    { permission: 'members.manage' },
    createRoute({
      method: 'delete',
      path: '/api/v1/orgs/{orgId}/invitations/{invitationId}',
      tags: ['invitations'],
      summary: 'Revoke a pending invitation',
      request: { params: InvitationParams },
      responses: { 204: { description: 'Revoked' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, invitationId } = c.req.valid('param');
      await withOrg(deps.db, orgId, async (tx) => {
        const revoked = await tx
          .update(schema.invitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.invitations.id, invitationId),
              eq(schema.invitations.orgId, orgId),
              isNull(schema.invitations.acceptedAt),
              isNull(schema.invitations.revokedAt),
            ),
          )
          .returning({ id: schema.invitations.id });
        if (revoked.length === 0) throw notFound('invitation');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'invitation.revoked',
          subject: `invitation:${invitationId}`,
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    'public',
    createRoute({
      method: 'get',
      path: '/api/v1/invitations/{token}',
      tags: ['invitations'],
      summary: 'What an invitation link is for (shown before signing in)',
      request: { params: TokenParams },
      responses: {
        200: json(
          z.object({
            orgName: z.string(),
            email: z.string(),
            role: RoleSchema,
            status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { token } = c.req.valid('param');
      const [row] = await withSystem(deps.db, (tx) =>
        tx
          .select({ invitation: schema.invitations, orgName: schema.orgs.name })
          .from(schema.invitations)
          .innerJoin(schema.orgs, eq(schema.orgs.id, schema.invitations.orgId))
          .where(eq(schema.invitations.tokenHash, hashToken(token))),
      );
      if (!row) throw notFound('invitation');
      const { invitation } = row;
      const status: 'pending' | 'accepted' | 'revoked' | 'expired' = invitation.acceptedAt
        ? 'accepted'
        : invitation.revokedAt
          ? 'revoked'
          : invitation.expiresAt <= new Date()
            ? 'expired'
            : 'pending';
      return c.json({ orgName: row.orgName, email: invitation.email, role: invitation.role, status }, 200);
    },
  );

  router.add(
    'authenticated',
    createRoute({
      method: 'post',
      path: '/api/v1/invitations/accept',
      tags: ['invitations'],
      summary: 'Accept an invitation with the signed-in account (its verified email must match)',
      request: jsonBody(z.object({ token: z.string().min(20).max(200) })),
      responses: { 200: json(z.object({ orgId: z.uuid() })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { token } = c.req.valid('json');
      const orgId = await withSystem(deps.db, async (tx) => {
        const [invitation] = await tx
          .select()
          .from(schema.invitations)
          .where(eq(schema.invitations.tokenHash, hashToken(token)))
          .for('update');
        if (!invitation || invitation.revokedAt) throw notFound('invitation');
        if (invitation.acceptedAt) {
          if (invitation.acceptedBy === user.id) return invitation.orgId;
          throw new AppError(409, 'invitation_used', 'this invitation was already accepted');
        }
        if (invitation.expiresAt <= new Date())
          throw new AppError(410, 'invitation_expired', 'this invitation has expired');
        if (!user.emailVerified || user.email.toLowerCase() !== invitation.email) {
          throw new AppError(
            403,
            'invitation_email_mismatch',
            `sign in as ${invitation.email} to accept this invitation`,
          );
        }
        const [existing] = await tx
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(and(eq(schema.members.orgId, invitation.orgId), eq(schema.members.userId, user.id)));
        if (!existing) {
          await tx.insert(schema.members).values({
            id: uuidv7(),
            orgId: invitation.orgId,
            userId: user.id,
            role: invitation.role,
            teamId: invitation.teamId,
          });
          await ensureUserPrincipal(tx, {
            orgId: invitation.orgId,
            userId: user.id,
            name: user.name,
            teamId: invitation.teamId,
          });
        }
        await tx
          .update(schema.invitations)
          .set({ acceptedAt: new Date(), acceptedBy: user.id })
          .where(eq(schema.invitations.id, invitation.id));
        await auditByUser(tx, {
          orgId: invitation.orgId,
          userId: user.id,
          action: 'invitation.accepted',
          subject: `invitation:${invitation.id}`,
          data: { role: invitation.role },
        });
        return invitation.orgId;
      });
      return c.json({ orgId }, 200);
    },
  );
}
