# 0016 — Approvals, mandates and delegation (Phase 7)

**Status:** Accepted
**Date:** 2026-09-28

## Context

Policy could already answer `require_approval`, but nothing let a person say yes. Agents had keys and budgets but no scoped, provable authority, and no way to hand part of it to a sub-agent. ADR 0006 chose Ed25519 JWS for mandates; this ADR records how the rest was built.

## Decisions

1. **Approvals are rows with a fingerprint.** The fingerprint is `sha256(principal | rail | provider:model)`. A repeat of the same request reuses the pending approval rather than opening another.
   - Separation of duties is enforced in the database layer, so the dashboard, Slack and any future channel share it (A1). Nobody decides their own request or one from an agent they own.
   - Team leads decide only for their own team's agents.
   - Approving issues a **one-shot mandate**: `maxUses = 1`, capped at the approved amount, limited to that model and provider, valid for 24 h (A3). It reserves no money (A2). The agent retries with `x-aperture-approval: <id>`.
   - Requests nobody decides expire after 24 h, via the `approvals.expire` job every 5 minutes (A4).
2. **Mandates are enforced in the gateway, not only signed.**
   - A caller acts under its newest usable standing mandate, or under the one-shot mandate an approval names.
   - Every mandate in the chain becomes a policy layer.
   - The mandate's budget node joins the reserve path.
   - `uses` is counted with the rows locked, in the reserve transaction (P6).
   - Validity windows use database time (P5).
   - A caller that once had a standing mandate, and has none usable now, is denied. It does not fall back to acting with no mandate at all.
3. **Budget nodes chain.** A root mandate's budget sits under its holder's own principal budget, and a child's sits under its parent's. So a sub-agent's spend counts against every ancestor, including the agent that delegated.
4. **Delegation only narrows (P2).** `POST /v1/subagents` creates a principal (`parent_principal_id`), a key owned by the caller's owner, and a child mandate.
   - `isWithin` is checked against what the parent has left right now.
   - The child starts when the parent started and ends no later than the parent.
   - Depth is capped at 3.
   - Revoking cascades through a recursive CTE, and revokes the sub-agents and their keys (P4).
5. **Per-org Ed25519 keys**, envelope-encrypted like other secrets. The public keys are published at `/.well-known/aperture/orgs/{id}/jwks.json` and `/api/v1/orgs/{id}/jwks.json`. Rotation retires a key without deleting it, so old mandates still verify. `pnpm mandate-verify` checks a mandate chain offline, but it cannot see revocation.
6. **Agent surface.**
   - Gateway routes: `/v1/me`, `/v1/models`, `/v1/approvals`, `/v1/subagents` and `/v1/me/pause`.
   - `@aperture/sdk` is dependency-free and turns gateway errors into typed errors.
   - `@aperture/mcp` offers seven tools over stdio and over stateless Streamable HTTP; the gateway serves it at `/mcp`. The MCP tools call the gateway with the caller's own key, so they can't do anything the key can't (P10).
7. **Slack app** (optional; needs `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`).
   - Each org installs it with OAuth; the state is HMAC-signed and lasts 10 minutes.
   - Approval alerts post Approve / Deny buttons.
   - Clicks are verified with Slack's signing secret within a 5-minute window.
   - The clicking Slack user must map to a member through an email that both Slack (`is_email_confirmed`) and Aperture have verified.
   - Refusals come back as an ephemeral message only the clicker sees.
   - Orgs without the app keep the incoming webhook.
8. **Policy suggestions are computed on demand, with no job.**
   - Approvals now store which rule asked for them.
   - If a rule got 3 or more approvals and no denials in 30 days, the suggestion is to raise its threshold to 110% of the largest approval.
   - Applying one is an ordinary versioned, audited policy `PUT` with `expectedVersion`.

## Consequences

- An approval's retry uses only the one-shot mandate, not the caller's standing mandate. A person approved that exact request, so their decision takes the place of the standing scope for that one call.
- Decisions made in the dashboard don't edit the earlier Slack message. The message's buttons then answer that the request is no longer pending.
- Deferred:
  - signed email deep links (links go to the Approvals page, and sign-in is required anyway);
  - "similar past approvals" and budget impact on the Approvals page;
  - a Teams adapter;
  - publishing the SDK and MCP packages to a registry;
  - an MCP Inspector run against staging.
