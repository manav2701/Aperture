import type { Role } from '@aperture/core';
import type { KeyRing } from '@aperture/crypto';
import type { Database } from '@aperture/db';
import type { JobDeps } from '@aperture/jobs';
import type { EmailSender, Logger } from '@aperture/runtime';
import type { Auth } from '../auth';

export interface AppDeps {
  db: Database;
  auth: Auth;
  email: EmailSender;
  logger: Logger;
  webOrigin: string;
  /** Encrypts connection and credential secrets. */
  ring: KeyRing;
  /** HMAC pepper for gateway keys; also signs workspace tokens. */
  pepper: string;
  /** For "sync now" and connector calls made from requests (tests inject a fake provider). */
  jobs: JobDeps;
  /** The gateway, in-process or over HTTP; the workspace chat is proxied through it. */
  gateway: { fetch: (request: Request) => Response | Promise<Response> } | undefined;
  /** Base URL people point their SDKs at, shown in the UI. */
  gatewayPublicUrl: string | undefined;
}

export type SessionUser = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['user'];

/** The caller's membership in the org named by the route's `{orgId}`. */
export interface Membership {
  orgId: string;
  memberId: string;
  role: Role;
  teamId: string | null;
}

export interface AppEnv {
  Variables: {
    user: SessionUser | null;
    membership: Membership;
  };
}
