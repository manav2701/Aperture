import type { Role } from '@aperture/core';
import type { Database } from '@aperture/db';
import type { Logger } from '@aperture/runtime';
import type { Auth } from '../auth';
import type { EmailSender } from '../email';

export interface AppDeps {
  db: Database;
  auth: Auth;
  email: EmailSender;
  logger: Logger;
  webOrigin: string;
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
