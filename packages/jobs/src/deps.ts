import type { FetchLike } from '@aperture/connectors';
import type { KeyRing } from '@aperture/crypto';
import type { Database, DatabaseHandle } from '@aperture/db';
import type { EmailSender, Logger } from '@aperture/runtime';

export interface JobDeps {
  /** Non-owner app-role connection; jobs scope every transaction with withOrg / withSystem. */
  database: DatabaseHandle;
  ring: KeyRing;
  logger: Logger;
  email: EmailSender;
  /** Public web origin, for links in alert emails. */
  webOrigin: string;
  /** Provider HTTP; injected in tests. */
  fetch?: FetchLike | undefined;
}

export const dbOf = (deps: JobDeps): Database => deps.database.db;

/** Actor recorded in the audit log for automatic actions. */
export const SYSTEM_ACTOR = 'system:connector-sync';
