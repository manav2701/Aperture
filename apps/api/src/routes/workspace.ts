import { formatUsd, micros } from '@aperture/core';
import { and, desc, eq, inArray, isNotNull, or, schema, withOrg } from '@aperture/db';
import { SIGNED_URL_SECONDS } from '@aperture/media';
import { createRoute, z } from '@hono/zod-openapi';
import { requireUser, type Router } from '../http/access';
import type { AppDeps } from '../http/context';
import { callGatewayAs, myPrincipalId, passThrough } from '../http/gateway';
import { OrgParams, Timestamp, errorResponses, json, jsonBody } from '../http/schemas';

const usd = (value: bigint) => formatUsd(micros(value));

const MediaJobSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['image', 'video']),
    model: z.string(),
    status: z.enum(['running', 'succeeded', 'failed', 'expired_reconciling']),
    prompt: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    estimated: z.string(),
    cost: z.string().nullable(),
    error: z.string().nullable(),
    by: z.object({ id: z.uuid(), name: z.string() }),
    outputs: z.array(z.object({ url: z.string(), contentType: z.string() })),
    createdAt: Timestamp,
    completedAt: Timestamp.nullable(),
  })
  .openapi('MediaJob');

const proxied = { 200: { description: 'The gateway’s response, passed through' }, ...errorResponses };

export function registerWorkspaceRoutes(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/workspace/media-models',
      tags: ['workspace'],
      summary: 'Image and video models this org can use through its connected providers, with prices',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            storage: z.boolean(),
            images: z.array(z.object({ model: z.string(), price: z.string() })),
            videos: z.array(z.object({ model: z.string(), perSecond: z.string() })),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const { images, videos } = await withOrg(deps.db, orgId, async (tx) => {
        const connected = (
          await tx
            .select({ provider: schema.connections.provider })
            .from(schema.connections)
            .where(and(eq(schema.connections.orgId, orgId), eq(schema.connections.status, 'active')))
        ).map((row) => row.provider);
        // OpenRouter serves vendor/model ids; OpenAI and Google serve their own ids directly.
        const providers = connected.filter(
          (provider) => provider === 'openrouter' || provider === 'openai' || provider === 'google',
        );
        if (providers.length === 0) return { images: [], videos: [] };
        const rows = await tx.select().from(schema.mediaPrices).where(inArray(schema.mediaPrices.provider, providers));
        return {
          images: rows
            .filter((row) => row.kind === 'image')
            .map((row) => ({
              model: row.model,
              price:
                row.perImage !== null
                  ? `$${usd(row.perImage)} per image`
                  : `$${usd(row.perImageTokenPerM ?? 0n)} per million image tokens`,
            }))
            .sort((a, b) => a.model.localeCompare(b.model)),
          videos: rows
            .filter((row) => row.kind === 'video' && row.perSecond !== null)
            .map((row) => ({ model: row.model, perSecond: usd(row.perSecond ?? 0n) }))
            .sort((a, b) => a.model.localeCompare(b.model)),
        };
      });
      return c.json({ storage: deps.storage !== undefined, images, videos }, 200);
    },
  );

  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/workspace/estimate',
      tags: ['workspace'],
      summary: 'Preview the cost of a chat, image or video request, and whether it would be allowed',
      request: { params: OrgParams, ...jsonBody(z.record(z.string(), z.unknown())) },
      responses: proxied,
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      return passThrough(
        await callGatewayAs(deps, {
          orgId,
          userId: user.id,
          method: 'POST',
          path: '/v1/estimate',
          body: c.req.valid('json'),
        }),
      );
    },
  );

  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/workspace/images',
      tags: ['workspace'],
      summary: 'Generate images as yourself (through the gateway: policy, budget, private storage)',
      request: { params: OrgParams, ...jsonBody(z.record(z.string(), z.unknown())) },
      responses: proxied,
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      return passThrough(
        await callGatewayAs(deps, {
          orgId,
          userId: user.id,
          method: 'POST',
          path: '/v1/images/generations',
          body: c.req.valid('json'),
          signal: c.req.raw.signal,
        }),
      );
    },
  );

  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/workspace/videos',
      tags: ['workspace'],
      summary: 'Start a video as yourself; it finishes in the background',
      request: { params: OrgParams, ...jsonBody(z.record(z.string(), z.unknown())) },
      responses: { 202: { description: 'Submitted' }, ...proxied },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      return passThrough(
        await callGatewayAs(deps, {
          orgId,
          userId: user.id,
          method: 'POST',
          path: '/v1/videos',
          body: c.req.valid('json'),
        }),
      );
    },
  );

  router.add(
    { permission: 'workspace.use' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/workspace/media',
      tags: ['workspace'],
      summary: 'The gallery: your images and videos and your team’s, newest first, with 15-minute links',
      request: { params: OrgParams, query: z.object({ kind: z.enum(['image', 'video']).optional() }) },
      responses: { 200: json(z.object({ jobs: z.array(MediaJobSchema) })), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const { kind } = c.req.valid('query');
      const me = await myPrincipalId(deps, orgId, user.id);
      const teamId = c.var.membership.teamId;
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ job: schema.mediaJobs, by: { id: schema.principals.id, name: schema.principals.name } })
          .from(schema.mediaJobs)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.mediaJobs.principalId))
          .where(
            and(
              eq(schema.mediaJobs.orgId, orgId),
              kind === undefined ? undefined : eq(schema.mediaJobs.kind, kind),
              // Yours, plus anything made by someone (or an agent) in your team.
              teamId === null
                ? eq(schema.mediaJobs.principalId, me)
                : or(
                    eq(schema.mediaJobs.principalId, me),
                    and(isNotNull(schema.principals.teamId), eq(schema.principals.teamId, teamId)),
                  ),
            ),
          )
          .orderBy(desc(schema.mediaJobs.createdAt))
          .limit(60),
      );
      const storage = deps.storage;
      const jobs = await Promise.all(
        rows.map(async ({ job, by }) => ({
          id: job.id,
          kind: job.kind,
          model: job.model,
          status: job.status,
          prompt: job.prompt,
          params: job.params,
          estimated: usd(job.estimated),
          cost: job.cost === null ? null : usd(job.cost),
          error: job.error,
          by,
          outputs:
            job.status === 'succeeded' && storage !== undefined
              ? await Promise.all(
                  job.outputs.map(async (output) => ({
                    url: await storage.signedUrl(output.key, SIGNED_URL_SECONDS),
                    contentType: output.contentType,
                  })),
                )
              : [],
          createdAt: job.createdAt.toISOString(),
          completedAt: job.completedAt?.toISOString() ?? null,
        })),
      );
      return c.json({ jobs }, 200);
    },
  );
}
