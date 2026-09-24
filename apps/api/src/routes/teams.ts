import { and, eq, schema, withOrg } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, notFound } from '../http/errors';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';

const TeamSchema = z
  .object({ id: z.uuid(), name: z.string(), archived: z.boolean(), createdAt: Timestamp })
  .openapi('Team');
const PrincipalSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['user', 'agent']),
    name: z.string(),
    status: z.enum(['active', 'paused', 'revoked']),
    userId: z.string().nullable(),
    teamId: z.uuid().nullable(),
  })
  .openapi('Principal');

const TeamParams = OrgParams.extend({ teamId: z.uuid().openapi({ param: { name: 'teamId', in: 'path' } }) });
const TeamName = z.string().trim().min(1).max(80);

const toTeam = (row: typeof schema.teams.$inferSelect) => ({
  id: row.id,
  name: row.name,
  archived: row.archivedAt !== null,
  createdAt: row.createdAt.toISOString(),
});

const isUniqueViolation = (error: unknown) => {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
};

export function registerTeamRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'teams.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/teams',
      tags: ['teams'],
      request: { params: OrgParams },
      responses: { 200: json(z.object({ teams: z.array(TeamSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx.select().from(schema.teams).where(eq(schema.teams.orgId, orgId)).orderBy(schema.teams.name),
      );
      return c.json({ teams: rows.map(toTeam) }, 200);
    },
  );

  router.add(
    { permission: 'teams.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/teams',
      tags: ['teams'],
      request: { params: OrgParams, ...jsonBody(z.object({ name: TeamName })) },
      responses: { 201: json(TeamSchema, 'Created'), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const { name } = c.req.valid('json');
      try {
        const team = await withOrg(deps.db, orgId, async (tx) => {
          const [created] = await tx.insert(schema.teams).values({ id: uuidv7(), orgId, name }).returning();
          if (!created) throw new Error('insert returned no row');
          await auditByUser(tx, {
            orgId,
            userId: user.id,
            action: 'team.created',
            subject: `team:${created.id}`,
            data: { name },
          });
          return created;
        });
        return c.json(toTeam(team), 201);
      } catch (error) {
        if (isUniqueViolation(error)) throw new AppError(409, 'team_exists', 'a team with that name already exists');
        throw error;
      }
    },
  );

  router.add(
    { permission: 'teams.manage' },
    createRoute({
      method: 'patch',
      path: '/api/v1/orgs/{orgId}/teams/{teamId}',
      tags: ['teams'],
      summary: 'Rename or archive a team',
      request: {
        params: TeamParams,
        ...jsonBody(z.object({ name: TeamName.optional(), archived: z.boolean().optional() })),
      },
      responses: { 200: json(TeamSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, teamId } = c.req.valid('param');
      const body = c.req.valid('json');
      const team = await withOrg(deps.db, orgId, async (tx) => {
        const changes = {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.archived === undefined ? {} : { archivedAt: body.archived ? new Date() : null }),
        };
        const [updated] = await tx
          .update(schema.teams)
          .set(changes)
          .where(and(eq(schema.teams.id, teamId), eq(schema.teams.orgId, orgId)))
          .returning();
        if (!updated) throw notFound('team');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'team.updated',
          subject: `team:${teamId}`,
          data: {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.archived === undefined ? {} : { archived: body.archived }),
          },
        });
        return updated;
      });
      return c.json(toTeam(team), 200);
    },
  );

  router.add(
    { permission: 'principals.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/principals',
      tags: ['principals'],
      summary: 'Everyone and everything that can spend: people now, agents from Phase 5',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ principals: z.array(PrincipalSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx.select().from(schema.principals).where(eq(schema.principals.orgId, orgId)).orderBy(schema.principals.name),
      );
      return c.json(
        {
          principals: rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            name: row.name,
            status: row.status,
            userId: row.userId,
            teamId: row.teamId,
          })),
        },
        200,
      );
    },
  );
}
