import { schema } from '@aperture/db';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import type { Router } from '../http/access';
import type { AppDeps } from '../http/context';
import { AppError } from '../http/errors';
import { errorResponses, json, jsonBody } from '../http/schemas';

/*
 * The private-beta waitlist. Sign-up is closed while AUTH_ALLOWED_EMAILS is set (see auth.ts),
 * so the landing page collects addresses here instead.
 *
 * Joining is public, which makes it the one place an anonymous caller can write a row. Three
 * things keep that cheap: sameOriginWrites rejects anything without the web app's Origin, the
 * unique address means a repeat submission updates nothing, and the window below caps one IP.
 */

const WINDOW_MS = 60 * 60 * 1000;
/** Generous, because a whole office can share one address and a blocked colleague is the worse failure. */
const PER_IP_PER_WINDOW = 10;

/**
 * Fixed window per IP. In memory on purpose: it is a spam cap, not a security boundary, and the
 * cost of a restart forgetting it is a handful of extra rows.
 */
class JoinLimiter {
  private readonly windows = new Map<string, { count: number; startedAt: number }>();

  allow(ip: string, now = Date.now()): boolean {
    const current = this.windows.get(ip);
    if (current === undefined || now - current.startedAt >= WINDOW_MS) {
      this.windows.set(ip, { count: 1, startedAt: now });
      // Entries only ever accumulate otherwise; a caller whose window has lapsed is not kept.
      for (const [key, window] of this.windows) if (now - window.startedAt >= WINDOW_MS) this.windows.delete(key);
      return true;
    }
    if (current.count >= PER_IP_PER_WINDOW) return false;
    current.count += 1;
    return true;
  }
}

export function registerWaitlistRoutes(router: Router, deps: AppDeps): void {
  const limiter = new JoinLimiter();

  router.add(
    'public',
    createRoute({
      method: 'post',
      path: '/api/v1/public/waitlist',
      tags: ['waitlist'],
      summary: 'Ask for access to the private beta',
      request: {
        ...jsonBody(
          z.object({
            email: z.string().trim().toLowerCase().pipe(z.email()).meta({ example: 'ada@example.com' }),
            name: z.string().trim().min(1).max(100),
            company: z.string().trim().max(120).optional(),
            teamSize: z.enum(schema.WAITLIST_TEAM_SIZES).optional(),
            note: z.string().trim().max(1000).optional(),
            referrer: z.string().trim().max(120).optional(),
          }),
        ),
      },
      responses: {
        202: json(z.object({ joined: z.literal(true) }), 'On the list'),
        429: {
          description: 'Too many requests',
          content: errorResponses[400].content,
        },
        ...errorResponses,
      },
    }),
    async (c) => {
      // Only a header the proxy overwrites can be trusted (CLIENT_IP_HEADER, same as auth.ts).
      // Unset, there is nothing to key a window on, so the Origin check is the only cap.
      const ip = deps.clientIpHeader === undefined ? undefined : c.req.header(deps.clientIpHeader);
      if (ip !== undefined && !limiter.allow(ip)) {
        throw new AppError(429, 'too_many_requests', 'too many requests; try again later');
      }

      const entry = c.req.valid('json');
      await deps.db
        .insert(schema.waitlistSignups)
        .values({ id: uuidv7(), ...entry })
        // A second submission from the same address keeps the first answers rather than
        // overwriting them, and still reads as success: whether an address is already on the
        // list is not something a stranger gets to find out.
        .onConflictDoNothing({ target: schema.waitlistSignups.email });

      return c.json({ joined: true } as const, 202);
    },
  );
}
