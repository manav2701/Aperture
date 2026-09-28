import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Better Auth on this origin (/api/auth/*, proxied to the API). */
export const authClient = createAuthClient({
  plugins: [
    magicLinkClient(),
    // After a correct password, accounts with two-factor continue on /two-factor.
    twoFactorClient({
      onTwoFactorRedirect: () => {
        const next = new URLSearchParams(window.location.search).get('next') ?? '/app';
        // Outside React (a Better Auth callback), so a full navigation rather than the router.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/two-factor?next=${encodeURIComponent(next)}`);
      },
    }),
  ],
});

/** Only same-site paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (next?.startsWith('/') !== true || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
