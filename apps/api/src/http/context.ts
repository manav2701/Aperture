import type { Role } from '@aperture/core';
import type { KeyRing } from '@aperture/crypto';
import type { Database } from '@aperture/db';
import type { JobDeps } from '@aperture/jobs';
import type { SignerClient } from '@aperture/gateway';
import type { MediaStorage } from '@aperture/media';
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
  /** Private media storage, for gallery links; undefined disables media. */
  storage: MediaStorage | undefined;
  /** The Slack app's credentials; undefined disables install and interactive approvals. */
  slack?: { clientId: string; clientSecret: string; signingSecret: string } | undefined;
  /** Public origin of this API (for webhook URLs shown to people); defaults to the request's. */
  apiPublicUrl?: string | undefined;
  /** The x402 signer (private network or embedded); crypto payments are off without it. */
  signer?: SignerClient | undefined;
  /** Allow Solana mainnet connections (only after the legal opinion, C1). */
  mainnetX402?: boolean | undefined;
  /** Owners, admins and finance need two-factor to make changes (on in production). */
  enforceTwoFactor?: boolean | undefined;
  /** Aperture's own Stripe billing; plan limits apply only when set. */
  billing?: { secretKey: string; webhookSecret: string; prices: { team: string; business: string } } | undefined;
  /** Who signs attestations (Phase 11 §11.5): Aperture Cloud, or the operator of a self-hosted instance. */
  attestationIssuer?: { kind: 'aperture_cloud' | 'self_hosted'; instance: string } | undefined;
  /** The receipts inbox (Phase 12 §12.3); off until a domain and a signing secret are set. */
  inboundEmail?: { domain: string; secret: string; authservId: string | undefined } | undefined;
  /** Recorded in attestations. */
  apertureVersion?: string | undefined;
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
