# Phase 15 — Interop and distribution

**Goal:** fit into the stack a customer already runs, and be installable from the places their people already work. That means connectors for the clouds where enterprises buy AI, a LiteLLM connector instead of competing with it, standard exports (OpenTelemetry, SCIM, accounting APIs), Aperture listed as a connector or plugin inside Claude, ChatGPT, Claude Code, Cursor, and VS Code, small SDK adapters for agent frameworks, and compliance evidence packs.

**Duration:** ~3.5 weeks. The items are independent; build them in the order the pilot needs and skip what nobody asks for.
**Depends on:** Phases 4–14.
**Needs from you:** cloud accounts for live contract tests (AWS, Azure; a Google Cloud project exists); developer accounts for the listings (each marketplace has its own review); an Okta or Entra developer tenant (free) for SCIM tests.

## Why this phase

- **Enterprises buy AI through their cloud** (Bedrock, Azure OpenAI/Foundry, Vertex). Without those connectors a bigger deal stops at "we can't see most of our spend".
- **LiteLLM is the closest competitor** and is free and open source. Many customers already run it. A connector turns it into a channel: keep LiteLLM, add Aperture for approvals, mandates, cards, x402, and finance.
- **Distribution:** being one click away inside Claude, ChatGPT, and the coding tools is cheaper than any marketing.

## Scope

**In:** Bedrock, Azure OpenAI/Foundry, and Vertex connectors; a LiteLLM connector; OpenTelemetry trace export; a SCIM 2.0 server; Google Workspace and Microsoft 365 OAuth-grant discovery; accounting API push; Microsoft Teams approvals; framework adapters; marketplace listings; publishing the SDK, MCP server, and `@aperture/connect`; compliance evidence packs.

**Out:** routing through cloud model APIs that need request signing (Bedrock SigV4) in the first version; visibility comes first.

## Tasks

### 15.1 Cloud AI connectors

| Cloud | Visibility (v1) | Control (v1) | **VERIFY** |
|---|---|---|---|
| AWS Bedrock | Cost Explorer / Cost and Usage Report filtered to Bedrock, by tag and IAM principal | Alerts and budgets; optional IAM policy detach on breach for keys Aperture manages | Read-only IAM role via external ID; CUR delivery delay |
| Azure OpenAI / Foundry | Cost Management API by resource and deployment | Gateway passthrough to Azure OpenAI endpoints (api-key auth, same OpenAI format) | Deployment-name vs. model mapping; quotas |
| Google Vertex AI | Cloud Billing export (BigQuery) filtered to Vertex, reusing the Google connector's service account | Budget Pub/Sub to disable keys (already planned for Gemini) | Billing export latency |

- Same connector contract as Phase 4: usage import into the ledger as `visible` spend, mapped to principals by tag or credential, `unassigned` otherwise.
- Gateway routing for Bedrock (SigV4) is a later task if a customer needs it.

### 15.2 LiteLLM connector

- Read spend from a customer's LiteLLM proxy (its admin API: keys, teams, spend logs) into Aperture, mapped by key or team.
- **Push budgets:** Aperture budgets set the max budget and rate limits of the matching LiteLLM virtual keys, so LiteLLM enforces what Aperture decides. Approvals in Aperture can raise them.
- **VERIFY** the endpoints and authentication against the current LiteLLM release; pin a minimum version.
- Docs: "Keep LiteLLM, add Aperture" guide.

### 15.3 OpenTelemetry export

- Per-org setting: export gateway traces and spend metrics over OTLP to any endpoint (Langfuse, Datadog, Grafana, Honeycomb), using the OpenTelemetry GenAI semantic conventions (**VERIFY** the current version).
- No prompt or response content unless the policy's `prompt_logging` is `full`. The export endpoint goes through the SSRF guard.

### 15.4 Identity: SCIM and OAuth-grant discovery

- **SCIM 2.0 server** (`/scim/v2/Users`, `/scim/v2/Groups`) for Okta and Microsoft Entra: create, update, and deactivate members; groups map to teams. **Deactivation** pauses the person's agents, revokes their keys and telemetry tokens, flags their seats for reclaim (Phase 12), and freezes their cards. Each step is audited.
- **OAuth-grant discovery** (from the Phase 11 backlog): list third-party AI apps employees connected to Google Workspace (Admin SDK Tokens) or Microsoft 365 (Entra enterprise apps and consents). They appear as shadow-AI items. **VERIFY** scopes.

### 15.5 Accounting API push and Teams approvals

- OAuth connections to **Xero**, **QuickBooks Online**, and **Zoho Books**; post the Phase 14 closing journal as a draft (never auto-approved) for finance to review.
- **Microsoft Teams adapter** for approvals (Adaptive Cards), matching the Slack app from Phase 7. Build it only if the design partner uses Teams.

### 15.6 Aperture inside other platforms (distribution)

| Where | What it does | **VERIFY** |
|---|---|---|
| **Claude** (custom connector, remote MCP) | "How much budget is left?", "Request $200 for the Q4 campaign", "Approve Sara's request", agent cards | Remote MCP auth requirements (OAuth), plan availability, directory listing process |
| **ChatGPT** (connectors / apps, remote MCP) | Same tools | Which plans allow custom connectors; app directory review |
| **Claude Code** (plugin marketplace) | The Phase 12 plugin: telemetry, MCP tools, approval hook | Marketplace format and review |
| **Cursor, VS Code** (MCP config, extension) | One-click "Add to Cursor" / "Add to VS Code" MCP install | Deep-link formats |
| **Slack / Teams** | Approvals (built / 15.5) | — |

- Remote MCP endpoint `https://mcp.<domain>` hosting `@aperture/mcp` with OAuth sign-in to the org, scoped per member (a member sees their own budgets; approvers can approve).
- **Publish** `@aperture/sdk`, `@aperture/mcp`, and `@aperture/connect` to npm (from `deferred.md`), with provenance, and run the MCP Inspector against staging.

### 15.7 Agent framework adapters

Small packages that attach agent identity, task, mandate, and tags (Phase 14) to every model call and check `may I spend $X?` before paid tool calls:
- LangChain / LangGraph callback handler
- Vercel AI SDK middleware
- OpenAI Agents SDK hooks
- Claude Agent SDK hooks

Each is a thin wrapper around `@aperture/sdk` with an example app.

### 15.8 Compliance evidence packs

Extends 11.6. A zip per period and framework: the signed attestation, the audit export, agent cards (with purpose, data classes, risk tier), posture history, approvals, and a control-mapping table that says which records relate to which clause. Frameworks: ISO/IEC 42001 Annex A, NIST AI RMF, EU AI Act record-keeping and human-oversight duties for deployers, and the UAE AI Charter / DIFC Regulation 10 for GCC buyers. Wording is always **"related to"**, never "compliant with". **VERIFY** every mapping and current EU AI Act dates with counsel.

## Edge cases

- **I1** Cloud cost data arrives up to a day late → shown as "imported through <date>"; posture uses freshness, not zero.
- **I2** LiteLLM and Aperture both set a budget → Aperture's push wins and logs the previous value; manual edits in LiteLLM are detected on the next sync and flagged.
- **I3** SCIM deactivates the last owner → refused with an error to the identity provider; an alert goes to the other admins.
- **I4** A remote MCP token is stolen → short-lived, scoped to one member, revocable from the dashboard; approvals still need the approver's role.
- **I5** An accounting push fails halfway → drafts are idempotent by period and cost centre; retry never duplicates.

## Tests

- Contract tests against fakes for every connector (Bedrock cost, Azure cost, Vertex billing export, LiteLLM, SCIM, Xero, QuickBooks, Zoho). Live runs within the USD 1 cap where spend is involved; read-only APIs cost nothing.
- SCIM: the Okta and Entra SCIM validators (**VERIFY** availability) pass.
- MCP: the Inspector exercises every tool over remote transport with OAuth.
- Evidence pack: the attestation inside verifies; the audit export recomputes the Merkle root.

## Security checklist

- [ ] Cloud credentials are read-only roles with external IDs where supported
- [ ] OTLP export and every outbound connector go through the SSRF guard
- [ ] SCIM tokens are per org, hashed, rotatable; SCIM can't create owners
- [ ] Remote MCP uses OAuth with per-member scopes; no long-lived bearer tokens in configs
- [ ] Published packages use npm provenance and 2FA on the npm account

## Deployment

New routes: `/scim/v2/*` on the API, the remote MCP service on `mcp.<domain>` (a small Cloud Run service). Connector jobs for each new provider. Marketplace listings are manual submissions you make (see the roadmap's owner steps).

## Try it yourself

1. Connect a test AWS account with a little Bedrock usage → it appears as `visible` spend.
2. Point Aperture at a local LiteLLM proxy → its keys' spend appears; change a budget in Aperture → LiteLLM's key budget changes.
3. Add Aperture as a custom connector in your own Claude account → ask "How much of my budget is left?"
4. Connect a free Okta developer tenant, assign yourself → a member appears; deactivate → your test agent is paused and its keys revoked.
5. Download an evidence pack for last month and verify the attestation inside it.

## Exit criteria

- [ ] The connectors the pilot needs are live; the others are built on fakes or explicitly deferred
- [ ] LiteLLM connector with budget push
- [ ] SCIM with deactivation cascade
- [ ] Remote MCP live with OAuth; SDK, MCP, and connect packages published; at least one marketplace listing submitted
- [ ] Evidence pack for at least one framework, wording approved by counsel
- [ ] ADR 0024 written
