# 0020 — Posture, inventory, shadow AI, attestations and agent cards (Phase 11)

**Status:** Accepted. Built and tested locally on Testcontainers Postgres; staging verification is the next step.
**Date:** 2026-10-08

## Decisions

1. **Posture is a pure function over a snapshot.**
   - `collectPostureSnapshot(tx, orgId, now)` in `@aperture/db` runs fixed aggregate queries and never selects a secret column (`secret`, `private_key`, `delegate_secret`, `hash`). A test asserts this on the generated SQL.
   - `evaluatePosture(snapshot, catalogue, waivers, now)` in `@aperture/core` returns `pass`, `fail`, `unknown`, `not_applicable` or `waived` per check, with the subjects it covers.
   - Score: weights critical 10, high 5, medium 2, low 1. `unknown` scores as a failure (a governance product doesn't say "fine" when it can't see); `not_applicable` is left out.
   - **Catalogue v1** ships the Phase 11 checks and the Phase 12 checks (`seats.*`, `tools.*`, `telemetry.coverage`) together (D11-4). Every run stores the version it used.
2. **Waivers** need a reason and an expiry of at most 180 days. A waived failure stays listed and scores as passed. Creating, revoking and expiring a waiver are audited. The daily `posture.run` job alerts only on **new** critical or high failures, and on waivers that expire within 7 days.
3. **Coverage** splits 30-day AI spend into `enforced`, `visible`, `unassigned` and `external`, rounded with the largest-remainder method so the shares always sum to 100%.
4. **INV-16: external evidence never touches the ledger.** `external_spend` (from statements and receipts) is never written to `ledger_entries`, `holds` or `budget_usage`. It shows only in inventory, coverage, posture and attestations, labelled "external". Rows for a provider the org already connects are tagged `provider_billing` and left out of the external share (V12).
5. **Statements are parsed in the browser.** Only rows that match an AI vendor are sent. The server re-matches and re-validates each row (size and row limits, dedupe hash per org). Unrelated transactions never leave the user's machine.
6. **The AI tool and merchant catalogue lives in code** (`packages/core/src/ai-tools.ts`), not in a table (D11-1). It's reference data that changes with releases, and the browser needs it to match statements without an API call.
7. **Attestation signing key.**
   - On Aperture Cloud (`ATTESTATION_ISSUER=aperture_cloud`) a **platform key** signs. It's Ed25519, envelope-encrypted under the platform KEK in `platform_signing_keys`, and published with every retired key at `/.well-known/aperture/jwks.json`. The document says "observed by Aperture Cloud". Signing with the org's own key would only show that the org attests to itself.
   - A self-hosted install signs with its own instance key and says "attested by the operator of `<instance>`".
   - Rotation: `admin rotate-attestation-key` ([runbook](../runbooks/rotate-attestation-key.md)). `admin rotate-kek` re-wraps these keys with the other secrets.
8. **Attestations are JSON, signed as a compact JWS** (`typ: aperture-attestation+jws`, `type: aperture.governance-attestation`). The JSON is the record of truth.
   - Activity comes from the ledger and the audit chain, which are never deleted. Denials come from the request log, with a `requestLogComplete` flag when retention has already deleted part of the period (V6).
   - The audit proof gives the range, the previous and last hashes, and the Merkle root. A broken chain is stated as "broken at seq N" and never as intact (V5).
   - Attestations hold org and agent names and counts. They hold no emails, and a test checks this.
   - The PDF is rendered on download by a small built-in writer (D11-2), and built in the request rather than in a job (D11-3).
9. **Verification needs no trust in Aperture.**
   - `/verify` checks the JWS in the browser with WebCrypto, and checks a dropped-in audit export's range and Merkle root.
   - `pnpm attestation-verify att.json --jwks … [--audit …]` does the same offline and also checks that the readable `document` field equals the signed payload.
   - Both refuse a validly signed document of another type: agent cards share the platform key.
10. **Agent cards** put one agent on one page.
    - `principals` gains `purpose`, `data_classes` and `risk_tier`. These are self-declared. Only owners and admins set the risk tier, and every change is audited.
    - The card is also served as JSON, as a signed JWS (`typ: aperture-agent-card+jws`), to the agent itself at `GET /v1/card`, and through the MCP tool `get_agent_card`.
    - Check `agents.high_risk_hard_capped` requires every high-risk agent to sit under a hard budget and an approval threshold.
11. **Permissions:** `posture.read`, `posture.waive` (owner and admin), `inventory.read`, `external_spend.import`, `attestation.create` and `attestation.read`, with the grants from the Phase 11 plan. Team leads see only their team's subjects.

## Consequences

- Waiting on people, not code:
  - counsel approves the disclaimer wording;
  - the design partner confirms the thresholds (30, 90 and 365 days; 2–3 owners);
  - descriptor strings are checked against real (redacted) statements before we trust the matcher's precision.
- Framework mapping (11.6) stays empty (`frameworks: []`) until a design partner asks for it.
- The posture performance target (p95 < 2 s for 10k agents) is not measured yet. It belongs in the Phase 13 load work.
