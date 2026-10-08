import { mapOtlpMetrics, otlpMetricsSchema } from '@aperture/core';
import { hashApiKey } from '@aperture/crypto';
import { addToolUsage, and, eq, isNull, schema, withOrg, withSystem } from '@aperture/db';
import type { Hono } from 'hono';
import type { GatewayDeps } from './pipeline';

/*
 * The OTLP receiver for terminal-tool telemetry (plan/phases/phase-12 §12.5, decision D12-1):
 * OTLP over HTTP with JSON only, authenticated by a telemetry token (`apt_tel_…`) that belongs
 * to one member and can do nothing else. Only allow-listed metrics and attributes are kept
 * (see @aperture/core telemetry); logs are accepted and dropped, so prompt text that a
 * misconfigured client sends is never stored.
 */

const TOKEN = /^apt_tel_[A-Za-z0-9_-]{32}$/;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUESTS_PER_MINUTE = 120;

interface TokenOwner {
  id: string;
  orgId: string;
  userId: string;
  tool: string;
}

function tokenFrom(request: Request): string | undefined {
  const header = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  return bearer !== undefined && TOKEN.test(bearer) ? bearer : undefined;
}

const otlpError = (status: number, message: string) => Response.json({ code: status, message }, { status });

export function registerTelemetryRoutes(app: Hono, deps: GatewayDeps): void {
  const windows = new Map<string, { start: number; count: number }>();
  const allow = (tokenId: string) => {
    const now = Date.now();
    const window = windows.get(tokenId);
    if (window === undefined || now - window.start > 60_000) {
      if (windows.size > 50_000) windows.clear();
      windows.set(tokenId, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= REQUESTS_PER_MINUTE;
  };

  /** The token's owner, if the token is live and the owner is still a member of the org. */
  async function authenticate(request: Request): Promise<TokenOwner | Response> {
    const token = tokenFrom(request);
    if (token === undefined) return otlpError(401, 'missing or invalid telemetry token');
    const hash = hashApiKey(token, deps.pepper);
    const [owner] = await withSystem(deps.db, (tx) =>
      tx
        .select({
          id: schema.telemetryTokens.id,
          orgId: schema.telemetryTokens.orgId,
          userId: schema.telemetryTokens.userId,
          tool: schema.telemetryTokens.tool,
        })
        .from(schema.telemetryTokens)
        .innerJoin(
          schema.members,
          and(
            eq(schema.members.orgId, schema.telemetryTokens.orgId),
            eq(schema.members.userId, schema.telemetryTokens.userId),
          ),
        )
        .where(and(eq(schema.telemetryTokens.hash, hash), isNull(schema.telemetryTokens.revokedAt))),
    );
    if (owner === undefined) return otlpError(401, 'missing or invalid telemetry token');
    if (!allow(owner.id)) return otlpError(429, 'too many telemetry exports; slow down');
    return owner;
  }

  async function readJson(request: Request): Promise<unknown> {
    const type = request.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) throw new TypeError('protobuf');
    const length = Number(request.headers.get('content-length') ?? '0');
    if (length > MAX_BODY_BYTES) throw new RangeError('too large');
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) throw new RangeError('too large');
    return JSON.parse(text) as unknown;
  }

  const bodyError = (error: unknown) =>
    error instanceof TypeError
      ? otlpError(415, 'send OTLP as JSON: set OTEL_EXPORTER_OTLP_PROTOCOL=http/json')
      : error instanceof RangeError
        ? otlpError(413, 'the export is larger than 2 MB')
        : otlpError(400, 'the body is not valid JSON');

  app.post('/otlp/v1/metrics', async (c) => {
    const owner = await authenticate(c.req.raw);
    if (owner instanceof Response) return owner;
    let body: unknown;
    try {
      body = await readJson(c.req.raw);
    } catch (error) {
      return bodyError(error);
    }
    const parsed = otlpMetricsSchema.safeParse(body);
    if (!parsed.success) return otlpError(400, 'not an OTLP metrics export');
    const mapped = mapOtlpMetrics(parsed.data);
    const rows = mapped.rows.filter((row) => row.tool === owner.tool);
    await withOrg(deps.db, owner.orgId, async (tx) => {
      if (rows.length > 0) await addToolUsage(tx, owner.orgId, owner.userId, rows);
      await tx
        .update(schema.telemetryTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.telemetryTokens.id, owner.id));
    });
    const rejected = mapped.cumulativeIgnored;
    return Response.json(
      rejected > 0
        ? {
            partialSuccess: {
              rejectedDataPoints: rejected,
              errorMessage:
                'cumulative temporality is not accepted; set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta',
            },
          }
        : { partialSuccess: {} },
    );
  });

  // Logs and traces are accepted so a client configured to send them doesn't retry forever,
  // and dropped unread: they can carry prompt text and tool input.
  for (const path of ['/otlp/v1/logs', '/otlp/v1/traces'])
    app.post(path, async (c) => {
      const owner = await authenticate(c.req.raw);
      if (owner instanceof Response) return owner;
      await c.req.raw.body?.cancel();
      return Response.json({ partialSuccess: {} });
    });
}
