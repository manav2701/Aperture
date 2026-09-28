import type { FetchLike } from '@aperture/connectors';
import type { KeyRing } from '@aperture/crypto';
import type { Database, DatabaseHandle } from '@aperture/db';
import type { MediaStorage } from '@aperture/media';
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
  /** Private media storage; the media poller is idle without it. */
  storage?: MediaStorage | undefined;
  /** NOTARY_SECRET_KEY: the Solana wallet that writes daily audit anchors; anchoring is off without it. */
  notarySecret?: string | undefined;
}

export const dbOf = (deps: JobDeps): Database => deps.database.db;

/** Actor recorded in the audit log for automatic actions. */
export const SYSTEM_ACTOR = 'system:connector-sync';
