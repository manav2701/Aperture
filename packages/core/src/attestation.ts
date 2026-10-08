import type { CoverageStatus } from './coverage';
import type { PostureSeverity, PostureStatus } from './posture/types';

/*
 * Signed governance attestations (plan/phases/phase-11 §11.5). The JSON document is the record
 * of truth; the PDF is a rendering of it. It is signed as a compact JWS (EdDSA) by the platform
 * attestation key on Aperture Cloud, or by the instance key on a self-hosted install, and anyone
 * can verify it against the published JWKS without trusting Aperture.
 */

/** Wording for counsel to approve in the legal review (plan/your-checklist.md, step E22). */
export const ATTESTATION_DISCLAIMER =
  'This attestation records what Aperture observed and enforced. It is not a certification, audit opinion, or statement of regulatory compliance.';

export const ATTESTATION_TYPE = 'aperture.governance-attestation';
export const ATTESTATION_JWS_TYP = 'aperture-attestation+jws';

export interface AttestationDocument {
  type: typeof ATTESTATION_TYPE;
  version: 1;
  id: string;
  issuer: {
    /** `aperture_cloud`: observed by Aperture Cloud; `self_hosted`: attested by the operator of `instance`. */
    kind: 'aperture_cloud' | 'self_hosted';
    instance: string;
    /** Where the signing keys are published. */
    jwksUrl: string;
  };
  org: { id: string; name: string };
  period: { from: string; to: string; timezone: string };
  generatedAt: string;
  apertureVersion: string;
  posture: {
    catalogueVersion: number;
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    /** Results at the end of the period. */
    results: { id: string; severity: PostureSeverity; status: PostureStatus }[];
    /** The worst status each check had in any run during the period. */
    worstDuringPeriod: { id: string; status: PostureStatus }[];
    runs: number;
  };
  activity: {
    /** Net spend per rail in USD decimal strings, from the ledger. */
    spendByRail: Record<'gateway' | 'provider' | 'card' | 'x402', string>;
    /**
     * Allowed gateway and media requests come from the ledger (one hold each), which is never
     * deleted (V6). Denials are only in the request log, which retention deletes:
     * `requestLogComplete` says whether the log still covers the whole period.
     */
    decisions: { allowed: number; denied: Record<string, number>; requestLogComplete: boolean };
    approvals: { granted: number; denied: number; expired: number };
    mandates: { issued: number; revoked: number };
    killSwitchUses: number;
    waivers: { checkId: string; subjectId: string | null; reason: string; expiresAt: string }[];
  };
  coverage: { status: CoverageStatus; amount: string; basisPoints: number }[];
  audit: {
    events: number;
    firstSeq: number | null;
    lastSeq: number | null;
    /** Hash of the event before `firstSeq` (the genesis hash when the period starts the chain). */
    prevHash: string | null;
    lastHash: string | null;
    /** Merkle root of the period's event hashes; recompute with `pnpm attestation-verify --audit`. */
    merkleRoot: string | null;
    chainIntact: boolean;
    brokenAtSeq: number | null;
    anchors: { day: string; root: string; network: string; signature: string }[];
  };
  /** Agents by name with their declared risk tier: no emails or other personal data. */
  agents: { id: string; name: string; riskTier: string | null; status: string }[];
  disclaimer: typeof ATTESTATION_DISCLAIMER;
}
