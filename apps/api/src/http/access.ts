import { can, type Permission } from '@aperture/core';
import { schema, withOrg } from '@aperture/db';
import type { OpenAPIHono, RouteConfig, RouteHandler } from '@hono/zod-openapi';
import { and, eq } from '@aperture/db';
import type { MiddlewareHandler } from 'hono';
import type { AppDeps, AppEnv, Membership, SessionUser } from './context';
import { AppError, forbidden, notFound } from './errors';

/**
 * Who may call a route: anyone, any signed-in user, or a member of the route's org holding a
 * permission. Every route must declare one; a test enumerates the registry to enforce it.
 */
type Access = 'public' | 'authenticated' | { permission: Permission };

export interface RegisteredRoute {
  method: string;
  path: string;
  access: Access;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUser(c: { get: (key: 'user') => SessionUser | null }): SessionUser {
  const user = c.get('user');
  if (!user) throw new AppError(401, 'unauthenticated', 'sign in first');
  return user;
}

async function loadMembership(deps: AppDeps, orgId: string, userId: string): Promise<Membership | undefined> {
  return withOrg(deps.db, orgId, async (tx) => {
    const [member] = await tx
      .select({ id: schema.members.id, role: schema.members.role, teamId: schema.members.teamId })
      .from(schema.members)
      .where(and(eq(schema.members.orgId, orgId), eq(schema.members.userId, userId)));
    return member ? { orgId, memberId: member.id, role: member.role, teamId: member.teamId } : undefined;
  });
}

function accessMiddleware(deps: AppDeps, access: Access): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (access === 'public') return next();
    const user = requireUser(c);
    if (access === 'authenticated') return next();

    const orgId = c.req.param('orgId');
    // Unknown orgs and orgs you don't belong to look the same, so ids can't be probed.
    if (orgId === undefined || !UUID.test(orgId)) throw notFound('organization');
    const membership = await loadMembership(deps, orgId, user.id);
    if (!membership) throw notFound('organization');
    if (!can(membership.role, access.permission)) throw forbidden();
    c.set('membership', membership);
    return next();
  };
}

export interface Router {
  readonly routes: readonly RegisteredRoute[];
  add<R extends RouteConfig>(access: Access, route: R, handler: RouteHandler<R, AppEnv>): void;
}

/** Registers OpenAPI routes on `app`, each guarded by its declared access. */
export function createRouter(app: OpenAPIHono<AppEnv>, deps: AppDeps): Router {
  const routes: RegisteredRoute[] = [];
  return {
    routes,
    add(access, route, handler) {
      routes.push({ method: route.method.toUpperCase(), path: route.path, access });
      app.openapi({ ...route, middleware: [accessMiddleware(deps, access)] }, handler);
    },
  };
}

/**
 * Cross-site request forgery guard for the cookie-authenticated API: state-changing requests
 * must come from the web app's own origin. (Cookies are also SameSite=Lax.)
 */
export function sameOriginWrites(webOrigin: string): MiddlewareHandler<AppEnv> {
  const allowed = new URL(webOrigin).origin;
  return async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    const origin = c.req.header('origin');
    if (origin !== allowed) throw new AppError(403, 'cross_origin_request', 'requests must come from the Aperture app');
    return next();
  };
}
