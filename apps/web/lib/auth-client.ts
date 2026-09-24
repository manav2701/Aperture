import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Better Auth on this origin (/api/auth/*, proxied to the API). */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });

/** Only same-site paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (next?.startsWith('/') !== true || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
