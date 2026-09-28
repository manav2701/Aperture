import { normalizeModel, type Provider } from '@aperture/connectors';
import { estimateTextCost, evaluatePolicy, formatUsd, micros } from '@aperture/core';
import {
  and,
  budgetHeadroom,
  eq,
  lookupMediaPrice,
  lookupPrice,
  release,
  schema,
  settle,
  withOrg,
  type MediaPriceRow,
} from '@aperture/db';
import {
  MediaProviderError,
  SIGNED_URL_SECONDS,
  estimateImages,
  estimateVideo,
  extensionFor,
  googleMedia,
  mediaKey,
  openAiMedia,
  openRouterMedia,
  type MediaPrice,
  type MediaProvider,
} from '@aperture/media';
import { metrics } from '@aperture/runtime';
import type { Hono } from 'hono';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { decide, reserveWithAuthority, resolveAuthority } from './authority';
import { connectedProviders, loadPrincipalContext, upstreamKey, type Caller } from './context';
import { GatewayError, errorResponse } from './errors';
import { admit, type GatewayDeps } from './pipeline';

/*
 * Images (synchronous) and videos (asynchronous jobs) — plan/phases/phase-06 §6.2–6.4.
 * Same order as text: policy on an upper-bound estimate → reserve → call → settle the actual
 * cost → copy outputs into private storage (G14) → hand out 15-minute signed URLs.
 */

const IMAGE_HOLD_SECONDS = 15 * 60;
/** Longest a provider takes (about 30 minutes) plus 30 minutes; then the hold goes to reconciling (G12). */
const VIDEO_HOLD_SECONDS = 60 * 60;
const MAX_IMAGES = 4;
const MAX_VIDEO_SECONDS = 60;

const usd = (amount: bigint) => formatUsd(micros(amount));

const imageBody = z.object({
  model: z.string().min(1).max(200),
  prompt: z.string().min(1).max(8_000),
  n: z.number().int().min(1).max(MAX_IMAGES).default(1),
  size: z.string().max(20).optional(),
  quality: z.enum(['auto', 'low', 'medium', 'high']).optional(),
  resolution: z.string().max(10).optional(),
  aspect_ratio: z.string().max(10).optional(),
});

const videoBody = z.object({
  model: z.string().min(1).max(200),
  prompt: z.string().min(1).max(8_000),
  seconds: z.number().int().min(1).max(MAX_VIDEO_SECONDS),
  resolution: z.string().max(10).optional(),
  aspect_ratio: z.string().max(10).optional(),
  audio: z.boolean().optional(),
});

/** `vendor/model` ids go to OpenRouter; `gpt-image-…` to OpenAI; `veo-…` to Google directly. */
function routeMedia(kind: 'image' | 'video', model: string, connected: Set<string>): MediaProvider {
  if (model.includes('/')) {
    if (connected.has('openrouter')) return 'openrouter';
    throw new GatewayError('aperture_provider_not_connected', `connect OpenRouter to use ${model}`);
  }
  if (kind === 'image' && connected.has('openai')) return 'openai';
  if (kind === 'video' && model.startsWith('veo-') && connected.has('google')) return 'google';
  throw new GatewayError('aperture_provider_not_connected', `no connected provider serves ${model}`);
}

const toMediaPrice = (row: MediaPriceRow): MediaPrice => ({ ...row, provider: row.provider as MediaProvider });

async function logMediaRequest(
  deps: GatewayDeps,
  caller: Caller,
  entry: {
    id: string;
    provider: string;
    model: string;
    route: string;
    outcome: string;
    status: number;
    started: number;
    holdId?: string | null;
    estimated?: bigint | null;
    cost?: bigint | null;
    reasons?: unknown[];
  },
) {
  metrics.inc('aperture_gateway_requests_total', { outcome: entry.outcome, provider: entry.provider });
  try {
    await withOrg(deps.db, caller.orgId, (tx) =>
      tx.insert(schema.gatewayRequests).values({
        id: entry.id,
        orgId: caller.orgId,
        principalId: caller.principalId,
        apiKeyId: caller.apiKeyId,
        provider: entry.provider,
        model: entry.model,
        route: entry.route,
        outcome: entry.outcome,
        reasons: entry.reasons ?? [],
        status: entry.status,
        holdId: entry.holdId ?? null,
        estimated: entry.estimated ?? null,
        cost: entry.cost ?? null,
        latencyMs: Date.now() - entry.started,
        completedAt: new Date(),
      }),
    );
  } catch (error) {
    deps.logger.error({ err: error, requestId: entry.id }, 'failed to record gateway request');
  }
}

/**
 * Policy (with the caller's mandate) + reservation shared by images and videos. Returns the
 * hold, or throws a GatewayError — `aperture_approval_required` carries the approval to wait on.
 */
async function authorize(
  deps: GatewayDeps,
  caller: Caller,
  request: Request,
  input: {
    provider: MediaProvider;
    model: string;
    estimate: bigint;
    media: { images?: number; videoSeconds?: number };
    ttlSeconds: number;
    onExpiry: 'settle' | 'reconcile';
    requestId: string;
    route: string;
  },
) {
  const context = await loadPrincipalContext(deps.db, deps.cache, caller);
  const resource = `${input.provider}:${input.model}`;
  const authority = await resolveAuthority(deps, caller, request, { rail: 'gateway', resource });
  await decide(deps, caller, authority, {
    action: {
      rail: 'gateway',
      amount: micros(input.estimate),
      provider: input.provider,
      model: input.model,
      media: input.media,
    },
    context,
    resource,
    purpose: request.headers.get('x-aperture-purpose') ?? `${input.model} via ${input.route}`,
    route: input.route,
  });
  const reservation = await reserveWithAuthority(deps, caller, authority, {
    orgId: caller.orgId,
    principalId: caller.principalId,
    rail: 'gateway',
    amount: input.estimate,
    idempotencyKey: `media:${input.requestId}`,
    ttlSeconds: input.ttlSeconds,
    onExpiry: input.onExpiry,
    resource,
    externalRef: input.requestId,
    meta: { requestId: input.requestId, provider: input.provider, model: input.model, media: input.media },
  });
  if (reservation.ok) return reservation.hold;
  if (reservation.reason === 'budget_exceeded') {
    throw new GatewayError(
      'aperture_budget_exceeded',
      `budget "${reservation.budgetName}" has $${usd(reservation.remaining)} left; this needs up to $${usd(input.estimate)}`,
      { budget: reservation.budgetName, remaining_usd: usd(reservation.remaining), estimate_usd: usd(input.estimate) },
    );
  }
  if (reservation.reason === 'principal_inactive') {
    throw new GatewayError('aperture_principal_inactive', 'this agent or person is paused or revoked');
  }
  throw new GatewayError('aperture_no_budget', 'no budget covers this caller; ask an admin to set one');
}

/** The provider's own error, passed through (4xx) or reported as 502; nothing was charged. */
function upstreamFailure(error: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify({ error: { type: 'upstream_error', message: (error as Error).message } }), {
    status: status >= 400 && status < 600 ? status : 502,
    headers: { 'content-type': 'application/json', 'x-aperture-request-id': requestId },
  });
}

async function signedOutputs(deps: GatewayDeps, outputs: { key: string; contentType: string }[]) {
  const storage = deps.storage;
  if (storage === undefined) return [];
  return Promise.all(
    outputs.map(async (output) => ({
      url: await storage.signedUrl(output.key, SIGNED_URL_SECONDS),
      content_type: output.contentType,
    })),
  );
}

export function registerMediaRoutes(app: Hono, deps: GatewayDeps): void {
  // ------------------------------------------------------------------------------------------
  // Images: generated, stored and settled within the request.
  app.post('/v1/images/generations', async (c) => {
    const requestId = uuidv7();
    const started = Date.now();
    const admitted = await admit(deps, c.req.raw, 'openai', requestId);
    if (admitted instanceof Response) return admitted;
    const { caller, releaseSlot } = admitted;
    let meta = { provider: 'unknown', model: '' };
    try {
      if (deps.storage === undefined)
        throw new GatewayError('aperture_unavailable', 'media storage is not configured on this deployment');
      const parsed = imageBody.safeParse(admitted.body);
      if (!parsed.success)
        throw new GatewayError(
          'aperture_invalid_request',
          `invalid image request: ${parsed.error.issues[0]?.message ?? ''}`,
        );
      const body = parsed.data;
      const provider = routeMedia('image', body.model, await connectedProviders(deps.db, deps.cache, caller.orgId));
      meta = { provider, model: body.model };
      const priceRow = await withOrg(deps.db, caller.orgId, (tx) =>
        lookupMediaPrice(tx, { provider, model: body.model, kind: 'image' }),
      );
      const price = priceRow === undefined ? undefined : toMediaPrice(priceRow);
      const estimate =
        price === undefined
          ? null
          : estimateImages(price, { count: body.n, quality: body.quality, resolution: body.resolution });
      if (price === undefined || estimate === null)
        throw new GatewayError('aperture_model_unpriced', `Aperture has no image price for ${body.model}`);
      const key = await upstreamKey(deps.db, deps.ring, deps.cache, caller.orgId, provider);
      if (key === undefined)
        throw new GatewayError('aperture_provider_not_connected', `set up the gateway key for ${provider}`);

      const hold = await authorize(deps, caller, c.req.raw, {
        provider,
        model: body.model,
        estimate,
        media: { images: body.n },
        ttlSeconds: IMAGE_HOLD_SECONDS,
        onExpiry: 'settle',
        requestId,
        route: '/v1/images/generations',
      });

      const client = provider === 'openai' ? openAiMedia(key, deps.fetch) : openRouterMedia(key, deps.fetch);
      let result;
      try {
        result = await client.generateImages({
          model: body.model,
          prompt: body.prompt,
          count: body.n,
          size: body.size,
          quality: body.quality,
          resolution: body.resolution,
          aspectRatio: body.aspect_ratio,
        });
      } catch (error) {
        // Nothing was generated (or the provider doesn't bill a failed image): return the hold.
        await withOrg(deps.db, caller.orgId, (tx) => release(tx, { orgId: caller.orgId, holdId: hold.id }));
        const status = error instanceof MediaProviderError ? error.status : 502;
        await logMediaRequest(deps, caller, {
          id: requestId,
          ...meta,
          route: '/v1/images/generations',
          outcome: 'upstream_error',
          status,
          started,
          holdId: hold.id,
          estimated: estimate,
          cost: 0n,
        });
        return upstreamFailure(error, status, requestId);
      }

      const cost =
        result.exactCost ??
        (result.outputTokens !== undefined && price.perImageTokenPerM !== null
          ? (result.outputTokens * price.perImageTokenPerM + 999_999n) / 1_000_000n
          : estimate);
      await withOrg(deps.db, caller.orgId, (tx) =>
        settle(tx, {
          orgId: caller.orgId,
          holdId: hold.id,
          actualAmount: cost,
          meta: { requestId, images: result.files.length },
        }),
      );

      const jobId = uuidv7();
      const outputs: { key: string; contentType: string; bytes: number }[] = [];
      let storageError: string | null = null;
      try {
        for (const [index, file] of result.files.entries()) {
          const objectKey = mediaKey(caller.orgId, jobId, index, extensionFor(file.contentType));
          await deps.storage.put(objectKey, file.bytes, file.contentType);
          outputs.push({ key: objectKey, contentType: file.contentType, bytes: file.bytes.byteLength });
        }
      } catch (error) {
        storageError = `storing the output failed: ${(error as Error).message}`;
        deps.logger.error({ err: error, requestId }, 'media storage failed after generation');
      }
      await withOrg(deps.db, caller.orgId, (tx) =>
        tx.insert(schema.mediaJobs).values({
          id: jobId,
          orgId: caller.orgId,
          principalId: caller.principalId,
          apiKeyId: caller.apiKeyId,
          kind: 'image',
          provider,
          model: body.model,
          status: storageError === null ? 'succeeded' : 'failed',
          prompt: body.prompt,
          params: {
            count: body.n,
            ...(body.size === undefined ? {} : { size: body.size }),
            ...(body.quality === undefined ? {} : { quality: body.quality }),
            ...(body.resolution === undefined ? {} : { resolution: body.resolution }),
          },
          holdId: hold.id,
          estimated: estimate,
          cost,
          outputs,
          error: storageError,
          completedAt: new Date(),
        }),
      );
      await logMediaRequest(deps, caller, {
        id: requestId,
        ...meta,
        route: '/v1/images/generations',
        outcome: 'allowed',
        status: storageError === null ? 200 : 502,
        started,
        holdId: hold.id,
        estimated: estimate,
        cost,
      });
      if (storageError !== null) {
        return c.json(
          { error: { type: 'aperture_unavailable', message: `${storageError}; the generation was charged` } },
          502,
        );
      }
      return c.json(
        {
          created: Math.floor(Date.now() / 1000),
          data: await signedOutputs(deps, outputs),
          aperture: { job_id: jobId, cost_usd: usd(cost) },
        },
        200,
        { 'x-aperture-request-id': requestId, 'x-aperture-cost-usd': usd(cost) },
      );
    } catch (error) {
      if (!(error instanceof GatewayError)) {
        deps.logger.error({ err: error, requestId }, 'image request failed');
        return errorResponse(
          new GatewayError('aperture_unavailable', 'Aperture is temporarily unavailable; the request was not sent'),
          'openai',
          requestId,
        );
      }
      const outcome =
        error.type === 'aperture_budget_exceeded' || error.type === 'aperture_no_budget'
          ? 'denied_budget'
          : error.type === 'aperture_policy_denied'
            ? 'denied_policy'
            : error.type === 'aperture_approval_required'
              ? 'approval_required'
              : 'denied_other';
      await logMediaRequest(deps, caller, {
        id: requestId,
        ...meta,
        route: '/v1/images/generations',
        outcome,
        status: error.status,
        started,
        reasons: [error.message],
      });
      return errorResponse(error, 'openai', requestId);
    } finally {
      releaseSlot();
    }
  });

  // ------------------------------------------------------------------------------------------
  // Videos: submitted here, finished by the `media.poll` job.
  app.post('/v1/videos', async (c) => {
    const requestId = uuidv7();
    const started = Date.now();
    const admitted = await admit(deps, c.req.raw, 'openai', requestId);
    if (admitted instanceof Response) return admitted;
    const { caller, releaseSlot } = admitted;
    let meta = { provider: 'unknown', model: '' };
    try {
      if (deps.storage === undefined)
        throw new GatewayError('aperture_unavailable', 'media storage is not configured on this deployment');
      const parsed = videoBody.safeParse(admitted.body);
      if (!parsed.success)
        throw new GatewayError(
          'aperture_invalid_request',
          `invalid video request: ${parsed.error.issues[0]?.message ?? ''}`,
        );
      const body = parsed.data;
      const provider = routeMedia('video', body.model, await connectedProviders(deps.db, deps.cache, caller.orgId));
      meta = { provider, model: body.model };
      const priceRow = await withOrg(deps.db, caller.orgId, (tx) =>
        lookupMediaPrice(tx, { provider, model: body.model, kind: 'video' }),
      );
      const estimate =
        priceRow === undefined
          ? null
          : estimateVideo(toMediaPrice(priceRow), {
              seconds: body.seconds,
              resolution: body.resolution,
              audio: body.audio,
            });
      if (estimate === null)
        throw new GatewayError('aperture_model_unpriced', `Aperture has no per-second price for ${body.model}`);
      const key = await upstreamKey(deps.db, deps.ring, deps.cache, caller.orgId, provider);
      if (key === undefined)
        throw new GatewayError('aperture_provider_not_connected', `set up the gateway key for ${provider}`);

      const hold = await authorize(deps, caller, c.req.raw, {
        provider,
        model: body.model,
        estimate,
        media: { videoSeconds: body.seconds },
        ttlSeconds: VIDEO_HOLD_SECONDS,
        onExpiry: 'reconcile',
        requestId,
        route: '/v1/videos',
      });

      const client = provider === 'google' ? googleMedia(key, deps.fetch) : openRouterMedia(key, deps.fetch);
      let providerJobId: string;
      try {
        providerJobId = await client.submitVideo({
          model: body.model,
          prompt: body.prompt,
          seconds: body.seconds,
          resolution: body.resolution,
          aspectRatio: body.aspect_ratio,
          audio: body.audio,
        });
      } catch (error) {
        await withOrg(deps.db, caller.orgId, (tx) => release(tx, { orgId: caller.orgId, holdId: hold.id }));
        const status = error instanceof MediaProviderError ? error.status : 502;
        await logMediaRequest(deps, caller, {
          id: requestId,
          ...meta,
          route: '/v1/videos',
          outcome: 'upstream_error',
          status,
          started,
          holdId: hold.id,
          estimated: estimate,
          cost: 0n,
        });
        return upstreamFailure(error, status, requestId);
      }

      const jobId = uuidv7();
      await withOrg(deps.db, caller.orgId, (tx) =>
        tx.insert(schema.mediaJobs).values({
          id: jobId,
          orgId: caller.orgId,
          principalId: caller.principalId,
          apiKeyId: caller.apiKeyId,
          kind: 'video',
          provider,
          model: body.model,
          status: 'running',
          prompt: body.prompt,
          params: {
            seconds: body.seconds,
            ...(body.resolution === undefined ? {} : { resolution: body.resolution }),
            ...(body.aspect_ratio === undefined ? {} : { aspectRatio: body.aspect_ratio }),
            ...(body.audio === undefined ? {} : { audio: body.audio }),
          },
          holdId: hold.id,
          estimated: estimate,
          providerJobId,
        }),
      );
      await logMediaRequest(deps, caller, {
        id: requestId,
        ...meta,
        route: '/v1/videos',
        outcome: 'allowed',
        status: 202,
        started,
        holdId: hold.id,
        estimated: estimate,
      });
      return c.json(
        { id: jobId, status: 'running', model: body.model, held_usd: usd(estimate), poll_url: `/v1/media/${jobId}` },
        202,
        { 'x-aperture-request-id': requestId },
      );
    } catch (error) {
      if (!(error instanceof GatewayError)) {
        deps.logger.error({ err: error, requestId }, 'video request failed');
        return errorResponse(
          new GatewayError('aperture_unavailable', 'Aperture is temporarily unavailable; the request was not sent'),
          'openai',
          requestId,
        );
      }
      const outcome =
        error.type === 'aperture_budget_exceeded' || error.type === 'aperture_no_budget'
          ? 'denied_budget'
          : error.type === 'aperture_policy_denied'
            ? 'denied_policy'
            : error.type === 'aperture_approval_required'
              ? 'approval_required'
              : 'denied_other';
      await logMediaRequest(deps, caller, {
        id: requestId,
        ...meta,
        route: '/v1/videos',
        outcome,
        status: error.status,
        started,
        reasons: [error.message],
      });
      return errorResponse(error, 'openai', requestId);
    } finally {
      releaseSlot();
    }
  });

  // ------------------------------------------------------------------------------------------
  // A job's status and (when done) signed output URLs. Only the principal that created it.
  app.get('/v1/media/:id', async (c) => {
    const requestId = uuidv7();
    const admitted = await admit(deps, c.req.raw, 'openai', requestId, { body: false });
    if (admitted instanceof Response) return admitted;
    const { caller, releaseSlot } = admitted;
    try {
      const id = c.req.param('id');
      if (!/^[0-9a-f-]{36}$/i.test(id))
        return errorResponse(new GatewayError('aperture_invalid_request', 'unknown media job'), 'openai', requestId);
      const [job] = await withOrg(deps.db, caller.orgId, (tx) =>
        tx
          .select()
          .from(schema.mediaJobs)
          .where(and(eq(schema.mediaJobs.id, id), eq(schema.mediaJobs.principalId, caller.principalId))),
      );
      if (job === undefined) return c.json({ error: { type: 'not_found', message: 'unknown media job' } }, 404);
      return c.json(
        {
          id: job.id,
          kind: job.kind,
          model: job.model,
          status: job.status,
          estimated_usd: usd(job.estimated),
          cost_usd: job.cost === null ? null : usd(job.cost),
          error: job.error,
          outputs: job.status === 'succeeded' ? await signedOutputs(deps, job.outputs) : [],
        },
        200,
      );
    } finally {
      releaseSlot();
    }
  });

  // ------------------------------------------------------------------------------------------
  // What a request would cost and whether it would be allowed, without reserving anything.
  app.post('/v1/estimate', async (c) => {
    const requestId = uuidv7();
    const admitted = await admit(deps, c.req.raw, 'openai', requestId);
    if (admitted instanceof Response) return admitted;
    const { caller, releaseSlot } = admitted;
    try {
      const body = z
        .object({
          type: z.enum(['chat', 'image', 'video']),
          model: z.string().min(1).max(200),
          prompt: z.string().max(100_000).default(''),
          max_tokens: z.number().int().min(1).max(1_000_000).optional(),
          n: z.number().int().min(1).max(MAX_IMAGES).default(1),
          quality: z.string().optional(),
          resolution: z.string().optional(),
          seconds: z.number().int().min(1).max(MAX_VIDEO_SECONDS).default(4),
          audio: z.boolean().optional(),
        })
        .safeParse(admitted.body);
      if (!body.success)
        return errorResponse(
          new GatewayError('aperture_invalid_request', 'invalid estimate request'),
          'openai',
          requestId,
        );
      const request = body.data;
      const connected = await connectedProviders(deps.db, deps.cache, caller.orgId);

      let provider: string;
      let estimate: bigint | null = null;
      if (request.type === 'chat') {
        provider = request.model.includes('/') ? 'openrouter' : 'openai';
        const price = await withOrg(deps.db, caller.orgId, (tx) =>
          lookupPrice(tx, provider, normalizeModel(provider as Provider, request.model)),
        );
        if (price !== undefined) {
          estimate = estimateTextCost(
            {
              promptBytes: BigInt(Buffer.byteLength(request.prompt)),
              inputImages: 0n,
              maxOutputTokens: BigInt(request.max_tokens ?? 4096),
            },
            price,
          );
        }
      } else {
        provider = routeMedia(request.type, request.model, connected);
        const row = await withOrg(deps.db, caller.orgId, (tx) =>
          lookupMediaPrice(tx, { provider, model: request.model, kind: request.type as 'image' | 'video' }),
        );
        if (row !== undefined) {
          estimate =
            request.type === 'image'
              ? estimateImages(toMediaPrice(row), {
                  count: request.n,
                  quality: request.quality,
                  resolution: request.resolution,
                })
              : estimateVideo(toMediaPrice(row), {
                  seconds: request.seconds,
                  resolution: request.resolution,
                  audio: request.audio,
                });
        }
      }
      if (estimate === null) {
        return c.json(
          {
            allowed: false,
            outcome: 'deny',
            reasons: [{ code: 'model_unpriced', message: `no price for ${request.model}` }],
            estimate_usd: null,
          },
          200,
        );
      }
      const context = await loadPrincipalContext(deps.db, deps.cache, caller);
      const authority = await resolveAuthority(deps, caller, c.req.raw, {
        rail: 'gateway',
        resource: `${provider}:${request.model}`,
      });
      const decision = evaluatePolicy({
        action: {
          rail: 'gateway',
          amount: micros(estimate),
          provider,
          model: request.model,
          ...(request.type === 'image'
            ? { media: { images: request.n } }
            : request.type === 'video'
              ? { media: { videoSeconds: request.seconds } }
              : {}),
        },
        at: new Date(),
        timeZone: context.timezone,
        layers: [...context.layers, ...authority.layers],
      });
      const headroom = await withOrg(deps.db, caller.orgId, (tx) =>
        budgetHeadroom(tx, { orgId: caller.orgId, principalId: caller.principalId, rail: 'gateway' }),
      );
      const fits = headroom.remaining === null || headroom.remaining >= estimate;
      return c.json(
        {
          allowed: decision.outcome === 'allow' && fits,
          outcome: !fits && decision.outcome === 'allow' ? 'budget_exceeded' : decision.outcome,
          reasons: decision.reasons,
          estimate_usd: usd(estimate),
          remaining_usd: headroom.remaining === null ? null : usd(headroom.remaining),
          remaining_after_usd:
            headroom.remaining === null
              ? null
              : usd(headroom.remaining > estimate ? headroom.remaining - estimate : 0n),
          budget: headroom.budgetName,
        },
        200,
      );
    } catch (error) {
      if (error instanceof GatewayError) return errorResponse(error, 'openai', requestId);
      throw error;
    } finally {
      releaseSlot();
    }
  });
}
