import { signWorkspaceToken } from '@aperture/crypto';
import { and, eq, schema, withOrg } from '@aperture/db';
import type { AppDeps } from './context';
import { AppError, notFound } from './errors';

const WORKSPACE_TOKEN_SECONDS = 300;

/** The signed-in person's own principal in an org (created with their membership). */
export async function myPrincipalId(deps: AppDeps, orgId: string, userId: string): Promise<string> {
  const [row] = await withOrg(deps.db, orgId, (tx) =>
    tx
      .select({ id: schema.principals.id })
      .from(schema.principals)
      .where(and(eq(schema.principals.orgId, orgId), eq(schema.principals.userId, userId))),
  );
  if (!row) throw notFound('principal');
  return row.id;
}

/**
 * Calls the gateway as the signed-in person with a 5-minute workspace token, so the workspace
 * goes through exactly the same policy and budget checks as an agent, and the browser never
 * holds a key.
 */
export async function callGatewayAs(
  deps: AppDeps,
  input: { orgId: string; userId: string; method: 'GET' | 'POST'; path: string; body?: unknown; signal?: AbortSignal },
): Promise<Response> {
  if (deps.gateway === undefined)
    throw new AppError(503, 'gateway_unavailable', 'the gateway is not enabled on this deployment');
  const principalId = await myPrincipalId(deps, input.orgId, input.userId);
  const token = signWorkspaceToken(
    { orgId: input.orgId, principalId, exp: Math.floor(Date.now() / 1000) + WORKSPACE_TOKEN_SECONDS },
    deps.pepper,
  );
  return deps.gateway.fetch(
    new Request(`http://gateway.internal${input.path}`, {
      method: input.method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  );
}

/** Passes a gateway response through unchanged (status, body, content type, request id). */
export function passThrough(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-cache',
      'x-aperture-request-id': upstream.headers.get('x-aperture-request-id') ?? '',
      ...(upstream.headers.get('x-aperture-cost-usd') === null
        ? {}
        : { 'x-aperture-cost-usd': upstream.headers.get('x-aperture-cost-usd') ?? '' }),
    },
  });
}
