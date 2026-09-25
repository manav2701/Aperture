import { normalizeModel, type FetchLike, type Provider } from '@aperture/connectors';
import { actualTextCost, estimateTextCost, evaluatePolicy, formatUsd, micros, type TextPrice } from '@aperture/core';
import type { KeyRing } from '@aperture/crypto';
import { budgetHeadroom, lookupPrice, release, reserve, schema, settle, withOrg, type Database } from '@aperture/db';
import type { Logger } from '@aperture/runtime';
import { v7 as uuidv7 } from 'uuid';
import type { Adapter, Json, UsageReport } from './adapters';
import {
  connectedProviders,
  loadPrincipalContext,
  resolveCaller,
  upstreamKey,
  type Caller,
  type GatewayCache,
} from './context';
import { GatewayError, errorResponse } from './errors';
import type { RequestLimiter } from './limits';
import { sseObserver } from './sse';

export interface GatewayDeps {
  db: Database;
  ring: KeyRing;
  pepper: string;
  workspaceSecret: string;
  logger: Logger;
  cache: GatewayCache;
  limiter: RequestLimiter;
  /** Upstream HTTP; injected in tests with a scripted fake provider. */
  fetch?: FetchLike | undefined;
}

/** A hold outlives any single request; if we crash, `holds.expire` settles it at the estimate (O2). */
const HOLD_TTL_SECONDS = 15 * 60;
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;

export interface BuildInput {
  caller: Caller;
  body: Json;
  connected: Set<string>;
  /** Output-token cap from policy obligations, applied on the second build. */
  cap: bigint | undefined;
}

type Outcome =
  | 'allowed'
  | 'denied_policy'
  | 'denied_budget'
  | 'denied_inactive'
  | 'denied_other'
  | 'upstream_error'
  | 'client_disconnected';

function credentialFrom(request: Request): string | undefined {
  const bearer = request.headers.get('authorization');
  if (bearer?.toLowerCase().startsWith('bearer ') === true) return bearer.slice(7).trim();
  return request.headers.get('x-api-key') ?? request.headers.get('x-goog-api-key') ?? undefined;
}

/** Catalog lookup: OpenRouter prices by its own model ids, direct providers by theirs. */
const priceKey = (provider: Provider, model: string) => ({ provider, model: normalizeModel(provider, model) });

const usd = (amount: bigint) => formatUsd(micros(amount));

interface Accounting {
  requestId: string;
  caller: Caller;
  adapter: Adapter;
  route: string;
  started: number;
}

async function logRequest(
  deps: GatewayDeps,
  accounting: Accounting,
  entry: {
    outcome: Outcome;
    status: number;
    reasons?: unknown[];
    holdId?: string | null;
    estimated?: bigint | null;
    cost?: bigint | null;
    usage?: UsageReport | undefined;
  },
) {
  try {
    await withOrg(deps.db, accounting.caller.orgId, (tx) =>
      tx.insert(schema.gatewayRequests).values({
        id: accounting.requestId,
        orgId: accounting.caller.orgId,
        principalId: accounting.caller.principalId,
        apiKeyId: accounting.caller.apiKeyId,
        provider: accounting.adapter.provider,
        model: accounting.adapter.model,
        route: accounting.route,
        outcome: entry.outcome,
        reasons: entry.reasons ?? [],
        status: entry.status,
        holdId: entry.holdId ?? null,
        estimated: entry.estimated ?? null,
        cost: entry.cost ?? null,
        inputTokens:
          entry.usage === undefined
            ? null
            : Number(entry.usage.usage.inputTokens + (entry.usage.usage.cacheReadTokens ?? 0n)),
        outputTokens: entry.usage === undefined ? null : Number(entry.usage.usage.outputTokens),
        latencyMs: Date.now() - accounting.started,
        stream: accounting.adapter.stream,
        completedAt: new Date(),
      }),
    );
  } catch (error) {
    deps.logger.error({ err: error, requestId: accounting.requestId }, 'failed to record gateway request');
  }
}

function costOf(
  report: UsageReport | undefined,
  price: TextPrice,
  estimate: bigint,
): { cost: bigint; estimated: boolean } {
  if (report === undefined) return { cost: estimate, estimated: true };
  return { cost: report.exactCost ?? actualTextCost(report.usage, price), estimated: false };
}

/**
 * The decision pipeline (plan/phases/phase-05 §5.2): authenticate → parse → policy → estimate →
 * reserve → forward → stream through → settle. Nothing reaches the provider unless every step
 * before "forward" allowed it (INV-13).
 */
export async function governedRequest(
  deps: GatewayDeps,
  request: Request,
  route: string,
  format: Adapter['format'],
  build: (input: BuildInput) => Adapter,
): Promise<Response> {
  const requestId = uuidv7();
  const started = Date.now();
  const credential = credentialFrom(request);

  let caller: Caller | undefined;
  try {
    caller = credential === undefined ? undefined : await resolveCaller(deps.db, deps, credential);
  } catch (error) {
    deps.logger.error({ err: error, requestId }, 'key lookup failed');
    return errorResponse(
      new GatewayError('aperture_unavailable', 'Aperture is temporarily unavailable; the request was not sent'),
      format,
      requestId,
    );
  }
  if (caller === undefined) {
    return errorResponse(
      new GatewayError('aperture_unauthorized', 'missing or invalid Aperture key'),
      format,
      requestId,
    );
  }

  const releaseSlot = deps.limiter.acquire(caller.apiKeyId ?? `principal:${caller.principalId}`, caller.orgId);
  if (releaseSlot === undefined) {
    return errorResponse(
      new GatewayError('aperture_rate_limited', 'too many requests for this key; slow down'),
      format,
      requestId,
    );
  }

  let body: Json;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Json;
  } catch {
    releaseSlot();
    return errorResponse(
      new GatewayError('aperture_invalid_request', 'the request body must be a JSON object'),
      format,
      requestId,
    );
  }

  let keepSlot = false;
  try {
    const connected = await connectedProviders(deps.db, deps.cache, caller.orgId);
    const first = build({ caller, body, connected, cap: undefined });
    const accounting: Accounting = { requestId, caller, adapter: first, route, started };
    const deny = async (error: GatewayError, outcome: Outcome, reasons: unknown[] = [], estimated?: bigint) => {
      await logRequest(deps, accounting, { outcome, status: error.status, reasons, estimated: estimated ?? null });
      return errorResponse(error, format, requestId);
    };

    if (first.model === '')
      return await deny(new GatewayError('aperture_invalid_request', 'the request must name a model'), 'denied_other');
    const key = await upstreamKey(deps.db, deps.ring, deps.cache, caller.orgId, first.provider);
    if (key === undefined) {
      return await deny(
        new GatewayError(
          'aperture_provider_not_connected',
          `connect ${first.provider} in Aperture (Connections → gateway key) to use it through the gateway`,
        ),
        'denied_other',
      );
    }

    const lookup = priceKey(first.provider, first.model);
    const price = await withOrg(deps.db, caller.orgId, (tx) => lookupPrice(tx, lookup.provider, lookup.model));
    if (price === undefined) {
      return await deny(
        new GatewayError(
          'aperture_model_unpriced',
          `Aperture has no price for ${first.model}, so it can't be budgeted`,
        ),
        'denied_other',
      );
    }

    const context = await loadPrincipalContext(deps.db, deps.cache, caller);
    const promptBytes = BigInt(Buffer.byteLength(JSON.stringify(body)));
    const firstEstimate = estimateTextCost(
      { promptBytes, inputImages: 0n, maxOutputTokens: first.maxOutputTokens },
      price,
    );
    const decision = evaluatePolicy({
      action: { rail: 'gateway', amount: firstEstimate, provider: first.provider, model: first.model },
      at: new Date(),
      timeZone: context.timezone,
      layers: context.layers,
    });
    if (decision.outcome !== 'allow') {
      const type = decision.outcome === 'deny' ? 'aperture_policy_denied' : 'aperture_approval_required';
      const message = decision.reasons.map((reason) => reason.message).join('; ') || 'denied by policy';
      return await deny(
        new GatewayError(type, message, { reasons: decision.reasons }),
        'denied_policy',
        decision.reasons,
        firstEstimate,
      );
    }

    // Obligations: the policy's output cap shrinks the request (and the reservation) (G1).
    const adapter =
      decision.obligations.maxOutputTokens === undefined
        ? first
        : build({ caller, body, connected, cap: BigInt(decision.obligations.maxOutputTokens) });
    accounting.adapter = adapter;
    const estimate = estimateTextCost(
      { promptBytes, inputImages: 0n, maxOutputTokens: adapter.maxOutputTokens },
      price,
    );

    const reservation = await withOrg(deps.db, caller.orgId, (tx) =>
      reserve(tx, {
        orgId: caller.orgId,
        principalId: caller.principalId,
        rail: 'gateway',
        amount: estimate,
        idempotencyKey: `gateway:${request.headers.get('idempotency-key') ?? requestId}`,
        ttlSeconds: HOLD_TTL_SECONDS,
        onExpiry: 'settle',
        resource: `${adapter.provider}:${adapter.model}`,
        externalRef: requestId,
        meta: { requestId, route, model: adapter.model, provider: adapter.provider },
      }),
    );
    if (!reservation.ok) {
      if (reservation.reason === 'budget_exceeded') {
        return await deny(
          new GatewayError(
            'aperture_budget_exceeded',
            `budget "${reservation.budgetName}" has $${usd(reservation.remaining)} left; this request needs up to $${usd(estimate)}`,
            {
              budget: reservation.budgetName,
              remaining_usd: usd(reservation.remaining),
              estimate_usd: usd(estimate),
            },
          ),
          'denied_budget',
          [{ code: 'budget_exceeded', budget: reservation.budgetName }],
          estimate,
        );
      }
      if (reservation.reason === 'principal_inactive') {
        return await deny(
          new GatewayError('aperture_principal_inactive', 'this agent or person is paused or revoked'),
          'denied_inactive',
          [],
          estimate,
        );
      }
      return await deny(
        new GatewayError('aperture_no_budget', 'no budget covers this caller; ask an admin to set one'),
        'denied_budget',
        [],
        estimate,
      );
    }
    const hold = reservation.hold;

    const abort = new AbortController();
    const timeout = setTimeout(() => {
      abort.abort();
    }, UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await (deps.fetch ?? ((input, init) => fetch(input, init)))(adapter.url, {
        method: 'POST',
        headers: adapter.headers(key),
        body: JSON.stringify(adapter.body),
        signal: abort.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      await withOrg(deps.db, caller.orgId, (tx) => release(tx, { orgId: caller.orgId, holdId: hold.id }));
      deps.logger.warn({ err: error, requestId, provider: adapter.provider }, 'upstream unreachable');
      await logRequest(deps, accounting, {
        outcome: 'upstream_error',
        status: 502,
        holdId: hold.id,
        estimated: estimate,
        cost: 0n,
      });
      return errorResponse(
        new GatewayError('aperture_unavailable', `${adapter.provider} could not be reached; nothing was charged`),
        format,
        requestId,
      );
    }

    const baseHeaders = (extra: Record<string, string>) => ({
      'x-aperture-request-id': requestId,
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      ...extra,
    });

    // Upstream refused (4xx, 429, 5xx before output): nothing was produced, so nothing is charged (G4, G5).
    if (!upstream.ok) {
      clearTimeout(timeout);
      const text = await upstream.text();
      await withOrg(deps.db, caller.orgId, (tx) => release(tx, { orgId: caller.orgId, holdId: hold.id }));
      await logRequest(deps, accounting, {
        outcome: 'upstream_error',
        status: upstream.status,
        holdId: hold.id,
        estimated: estimate,
        cost: 0n,
      });
      const retryAfter = upstream.headers.get('retry-after');
      return new Response(text, {
        status: upstream.status,
        headers: baseHeaders(retryAfter === null ? {} : { 'retry-after': retryAfter }),
      });
    }

    let settled = false;
    const finish = async (report: UsageReport | undefined, outcome: Outcome) => {
      if (settled) return { cost: 0n };
      settled = true;
      clearTimeout(timeout);
      const { cost, estimated } = costOf(report, price, estimate);
      try {
        const result = await withOrg(deps.db, caller.orgId, (tx) =>
          settle(tx, {
            orgId: caller.orgId,
            holdId: hold.id,
            actualAmount: cost,
            meta: { requestId, estimatedCost: estimated, generationId: report?.generationId ?? null },
          }),
        );
        if (result.overage)
          deps.logger.warn(
            { requestId, estimate: estimate.toString(), cost: cost.toString() },
            'request cost more than its reservation (L6)',
          );
      } catch (error) {
        // The hold stays open and `holds.expire` settles it at the estimate.
        deps.logger.error({ err: error, requestId }, 'settlement failed; the hold will settle on expiry');
      }
      await logRequest(deps, accounting, {
        outcome,
        status: upstream.status,
        holdId: hold.id,
        estimated: estimate,
        cost,
        usage: report,
      });
      releaseSlot();
      return { cost };
    };

    if (!adapter.stream || upstream.body === null) {
      const text = await upstream.text();
      let report: UsageReport | undefined;
      try {
        report = adapter.usageFromJson(JSON.parse(text) as unknown);
      } catch {
        report = undefined;
      }
      keepSlot = true;
      const { cost } = await finish(report, 'allowed');
      const headroom = await withOrg(deps.db, caller.orgId, (tx) =>
        budgetHeadroom(tx, { orgId: caller.orgId, principalId: caller.principalId, rail: 'gateway' }),
      ).catch(() => undefined);
      return new Response(text, {
        status: upstream.status,
        headers: baseHeaders({
          'x-aperture-cost-usd': usd(cost),
          ...(headroom?.remaining == null ? {} : { 'x-aperture-budget-remaining-usd': usd(headroom.remaining) }),
        }),
      });
    }

    // Streaming: bytes go to the client as they arrive; usage is read from the final events.
    let report: UsageReport | undefined;
    const observer = sseObserver((event) => {
      report = adapter.usageFromEvent(event) ?? report;
    });
    const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();
    let cancelled = false;
    keepSlot = true;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            observer.end();
            controller.close();
            await finish(report, 'allowed');
            return;
          }
          observer.push(value);
          controller.enqueue(value);
        } catch (error) {
          // A read that fails because the client cancelled is settled by cancel() below.
          if (cancelled) return;
          controller.error(error);
          await finish(report, 'upstream_error');
        }
      },
      async cancel() {
        // The client went away (G3): stop the upstream generation and settle what we saw.
        cancelled = true;
        abort.abort();
        await reader.cancel().catch(() => undefined);
        await finish(report, 'client_disconnected');
      },
    });
    return new Response(stream, {
      status: upstream.status,
      headers: baseHeaders({ 'cache-control': 'no-cache', 'x-aperture-estimate-usd': usd(estimate) }),
    });
  } catch (error) {
    if (error instanceof GatewayError) return errorResponse(error, format, requestId);
    deps.logger.error({ err: error, requestId }, 'gateway request failed');
    // Fail closed: if Aperture can't decide, the request is not sent.
    return errorResponse(
      new GatewayError('aperture_unavailable', 'Aperture is temporarily unavailable; the request was not sent'),
      format,
      requestId,
    );
  } finally {
    if (!keepSlot) releaseSlot();
  }
}
