import { OpenAPIHono } from '@hono/zod-openapi';
import { sql } from '@aperture/db';
import { bodyLimit } from 'hono/body-limit';
import { createServiceApp } from '@aperture/runtime';
import { createRouter, sameOriginWrites, type RegisteredRoute } from './http/access';
import type { AppDeps, AppEnv } from './http/context';
import { errorBody, handleError } from './http/errors';
import { registerAuditRoutes } from './routes/audit';
import { registerBudgetRoutes } from './routes/budgets';
import { registerMemberRoutes } from './routes/members';
import { registerOrgRoutes } from './routes/orgs';
import { registerPolicyRoutes } from './routes/policies';
import { registerTeamRoutes } from './routes/teams';

export interface ApiApp {
  app: OpenAPIHono<AppEnv>;
  routes: readonly RegisteredRoute[];
}

export function buildApp(deps: AppDeps): ApiApp {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(errorBody('invalid_request', 'the request is invalid', result.error.issues), 400);
      }
      return undefined;
    },
  });

  // Health endpoints come from the shared service bootstrap; readiness pings the database.
  app.route(
    '/',
    createServiceApp({
      service: 'api',
      logger: deps.logger,
      readinessChecks: [
        {
          name: 'database',
          check: async () => {
            await deps.db.execute(sql`select 1`);
          },
        },
      ],
    }),
  );

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json(errorBody('payload_too_large', 'request body is too large'), 413),
    }),
  );

  // Authentication (Better Auth handles its own CSRF/origin checks and rate limits).
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw));

  app.use('/api/v1/*', sameOriginWrites(deps.webOrigin));
  app.use('/api/v1/*', async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    c.set('user', session?.user ?? null);
    await next();
  });

  const router = createRouter(app, deps);
  registerOrgRoutes(router, deps);
  registerMemberRoutes(router, deps);
  registerTeamRoutes(router, deps);
  registerBudgetRoutes(router, deps);
  registerPolicyRoutes(router, deps);
  registerAuditRoutes(router, deps);

  app.doc31('/api/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Aperture control-plane API', version: '0.3.0' },
  });

  app.notFound((c) => c.json(errorBody('not_found', 'no such route'), 404));
  app.onError((error, c) => handleError(error, c, deps.logger));

  return { app, routes: router.routes };
}
