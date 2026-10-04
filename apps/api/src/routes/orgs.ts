import { isValidTimeZone } from '@aperture/core';
import { schema, withOrg, withSystem } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq, isNotNull } from '@aperture/db';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, notFound } from '../http/errors';
import { OrgParams, RoleSchema, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';

const TimeZoneSchema = z.string().refine(isValidTimeZone, 'unknown IANA time zone').openapi({ example: 'Asia/Dubai' });

const OrgSchema = z
  .object({ id: z.uuid(), name: z.string(), timezone: z.string(), createdAt: Timestamp, role: RoleSchema })
  .openapi('Org');

const MeSchema = z
  .object({
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      emailVerified: z.boolean(),
      twoFactorEnabled: z.boolean(),
      /** False for accounts that only sign in with Google or a magic link. */
      hasPassword: z.boolean(),
    }),
    memberships: z.array(
      z.object({ orgId: z.uuid(), orgName: z.string(), role: RoleSchema, teamId: z.uuid().nullable() }),
    ),
  })
  .openapi('Me');

const OrgName = z.string().trim().min(1).max(100);

export function registerOrgRoutes(router: Router, deps: AppDeps): void {
  // Accounts created with Google or a magic link have no password; two-factor works on
  // password sign-in, so they create one first (Account → Security).
  router.add(
    'authenticated',
    createRoute({
      method: 'post',
      path: '/api/v1/me/password',
      tags: ['me'],
      summary: 'Create a password for an account that has none (Google or magic-link sign-up)',
      request: jsonBody(z.object({ newPassword: z.string().min(12).max(128) })),
      responses: { 204: { description: 'Password created' }, ...errorResponses },
    }),
    async (c) => {
      requireUser(c);
      const { newPassword } = c.req.valid('json');
      try {
        await deps.auth.api.setPassword({ body: { newPassword }, headers: c.req.raw.headers });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'could not set the password';
        throw new AppError(400, 'password_not_set', message);
      }
      return c.body(null, 204);
    },
  );

  router.add(
    'authenticated',
    createRoute({
      method: 'get',
      path: '/api/v1/me',
      tags: ['me'],
      summary: 'The signed-in user and their organizations',
      responses: { 200: json(MeSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      // Looks across orgs, but only for rows belonging to this user.
      const memberships = await withSystem(deps.db, (tx) =>
        tx
          .select({
            orgId: schema.members.orgId,
            orgName: schema.orgs.name,
            role: schema.members.role,
            teamId: schema.members.teamId,
          })
          .from(schema.members)
          .innerJoin(schema.orgs, eq(schema.orgs.id, schema.members.orgId))
          .where(eq(schema.members.userId, user.id))
          .orderBy(schema.orgs.name),
      );
      const [credential] = await withSystem(deps.db, (tx) =>
        tx
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(
            and(
              eq(schema.accounts.userId, user.id),
              eq(schema.accounts.providerId, 'credential'),
              isNotNull(schema.accounts.password),
            ),
          ),
      );
      return c.json(
        {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            twoFactorEnabled: (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
            hasPassword: credential !== undefined,
          },
          memberships,
        },
        200,
      );
    },
  );

  router.add(
    'authenticated',
    createRoute({
      method: 'post',
      path: '/api/v1/orgs',
      tags: ['orgs'],
      summary: 'Create an organization; the creator becomes its owner',
      request: jsonBody(z.object({ name: OrgName, timezone: TimeZoneSchema.default('Asia/Dubai') })),
      responses: { 201: json(OrgSchema, 'Created'), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      if (!user.emailVerified) throw new AppError(403, 'email_not_verified', 'verify your email first');
      const body = c.req.valid('json');
      const orgId = uuidv7();
      const org = await withOrg(deps.db, orgId, async (tx) => {
        const [created] = await tx
          .insert(schema.orgs)
          .values({ id: orgId, name: body.name, timezone: body.timezone })
          .returning();
        if (!created) throw new Error('insert returned no row');
        await tx.insert(schema.members).values({ id: uuidv7(), orgId, userId: user.id, role: 'owner' });
        await tx
          .insert(schema.principals)
          .values({ id: uuidv7(), orgId, kind: 'user', name: user.name, userId: user.id });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'org.created',
          subject: `org:${orgId}`,
          data: { name: body.name, timezone: body.timezone },
        });
        return created;
      });
      return c.json({ ...org, createdAt: org.createdAt.toISOString(), role: 'owner' as const }, 201);
    },
  );

  router.add(
    { permission: 'org.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}',
      tags: ['orgs'],
      request: { params: OrgParams },
      responses: { 200: json(OrgSchema), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const [org] = await withOrg(deps.db, orgId, (tx) =>
        tx.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)),
      );
      if (!org) throw notFound('organization');
      return c.json({ ...org, createdAt: org.createdAt.toISOString(), role: c.var.membership.role }, 200);
    },
  );

  router.add(
    { permission: 'org.update' },
    createRoute({
      method: 'patch',
      path: '/api/v1/orgs/{orgId}',
      tags: ['orgs'],
      summary: 'Rename the org or change its timezone',
      description:
        'The timezone decides where budget days and months start, so it can only change before any spend is recorded.',
      request: {
        params: OrgParams,
        ...jsonBody(z.object({ name: OrgName.optional(), timezone: TimeZoneSchema.optional() })),
      },
      responses: { 200: json(OrgSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      const org = await withOrg(deps.db, orgId, async (tx) => {
        const [current] = await tx.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)).for('update');
        if (!current) throw notFound('organization');
        if (body.timezone !== undefined && body.timezone !== current.timezone) {
          const [entry] = await tx
            .select({ id: schema.ledgerEntries.id })
            .from(schema.ledgerEntries)
            .where(eq(schema.ledgerEntries.orgId, orgId))
            .limit(1);
          if (entry) {
            throw new AppError(409, 'timezone_locked', 'the timezone can’t change after spend has been recorded');
          }
        }
        const changes = {
          ...(body.name ? { name: body.name } : {}),
          ...(body.timezone ? { timezone: body.timezone } : {}),
        };
        const [updated] = await tx
          .update(schema.orgs)
          .set(changes)
          .where(and(eq(schema.orgs.id, orgId)))
          .returning();
        if (!updated) throw notFound('organization');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'org.updated',
          subject: `org:${orgId}`,
          data: changes,
        });
        return updated;
      });
      return c.json({ ...org, createdAt: org.createdAt.toISOString(), role: c.var.membership.role }, 200);
    },
  );
}
