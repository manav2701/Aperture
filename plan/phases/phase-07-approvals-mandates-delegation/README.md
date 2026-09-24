# Phase 7 — Approvals, mandates, delegation, SDK and MCP

**Goal:** humans stay in control of large or unusual spend (approvals in Slack/email/dashboard), and agents act under **signed, scoped mandates** that can only narrow when delegated to sub-agents. Agents integrate through a proper SDK and an MCP server.
**Duration:** ~2.5 weeks.
**Depends on:** Phase 5 (gateway), Phase 2 (mandate model).

## Starting point

Policy engine returns `require_approval`; gateway returns `aperture_approval_required`; `isWithin()` exists; no signing, no approval UI, minimal SDK.

## Scope

**In:** approvals (model, API, dashboard, email, Slack app with interactive buttons); separation of duties; one-shot mandates from approvals; mandate issuance/revocation API and UI; Ed25519 JWS signing with per-org keys and a public JWKS; sub-agents and attenuation; delegation tree UI on real data; policy suggestions; full TypeScript SDK; MCP server.
**Out:** card-specific approval (single-use card) — Phase 8; x402 MCP tool — Phase 9.

## Tasks

### 7.1 Approvals
- Table and API per [architecture §14](../../architecture/README.md#14-approvals): create (from a denied decision, with request snapshot + fingerprint), list (queue for approvers with authority over the budget), approve (optional lower cap/shorter expiry), deny (reason), expire job.
- Separation of duties (A1): approver ≠ requester, ≠ agent owner; approver must have authority over the budget scope.
- On approve → create a **one-shot mandate** (`maxUses = 1`, amount ≤ approved cap, bound to fingerprint, 24 h) (A3). Retry with `x-aperture-approval: <id>`.
- Approval does not reserve money (A2); the retry reserves.

### 7.2 Notifications
- Email with signed deep links (login still required to act).
- **Slack app**: OAuth install per org, map Slack users → Aperture members (by verified email), interactive message with Approve/Deny; verify Slack signatures (5-minute tolerance) (A4); update the message after a decision.
- Dashboard **Approvals** page with context: budget impact, similar past approvals, policy reason.

### 7.3 Mandates
- Per-org Ed25519 signing key (envelope-encrypted); public keys at `/.well-known/aperture/orgs/{orgId}/jwks.json`; key rotation keeps old public keys.
- `POST /mandates` (human issuer → agent) and `POST /v1/mandates` (agent → its sub-agent, data plane, only within its own mandate) — both run `isWithin` against the parent (P2) and create a child budget under the parent's budget.
- Mandate fields per [architecture §10](../../architecture/README.md#10-mandates-and-delegation); `purpose` is required text (shown in audit and approvals).
- Enforcement: gateway/card/x402 pipelines load the mandate chain; policy evaluation includes every ancestor mandate's scope; `uses` incremented in the reserve transaction with the mandate row locked (P6); expiry checked with DB time (P5).
- Revocation cascades (recursive CTE) to descendants and their credentials; NOTIFY invalidation (P4).
- `GET /mandates/{id}/jws` export + `tools/mandate-verify`.

### 7.4 Sub-agents
- Agent creates a sub-agent via SDK/MCP: new principal (`parent_principal_id`), new key, new mandate within its own.
- Depth limit per org policy (default 3).

### 7.5 Delegation tree UI
- Agent detail → **Mandates** tab: tree of mandates and sub-agents with budget used/remaining, expiry, uses, revoke buttons. This replaces the legacy synthesized delegation page with real data.

### 7.6 Policy suggestions
- Nightly job groups approved requests by (scope, rule, amount bucket, provider/merchant); if ≥ N approvals and 0 denials in 30 days → suggestion card "raise threshold to USD X for Y" → one click creates a policy change (audited).

### 7.7 SDK (`packages/sdk`, published as `@aperture/sdk`)
- Clients: `gateway` (OpenAI/Anthropic preconfigured), `budget.get()`, `estimate()`, `approvals.request()/wait()`, `mandates.createSubAgent()`, `mandates.current()`.
- Typed errors: `BudgetExceededError`, `PolicyDeniedError`, `ApprovalRequiredError { approvalId }`.
- Docs + examples in `packages/sdk/README.md`; semantic versioning; changelog.

### 7.8 MCP server (`packages/mcp`, `@aperture/mcp`)
- Stdio and Streamable HTTP transports; authenticated by an Aperture key.
- Tools: `get_budget`, `estimate_cost`, `list_allowed_models`, `request_approval`, `check_approval`, `create_subagent`, `pause_self` (lets an agent stop itself). (`pay_x402` and `create_task_card` added in Phases 8–9.)
- Tool descriptions state limits plainly so the model doesn't try to work around them.

## Edge cases covered

P2, P4, P5, P6, A1–A4, P10 (agents can't approve or alter policy through MCP).

## Tests

- **Unit:** SoD checks; fingerprint binding; JWS sign/verify with key rotation; depth limit.
- **Property:** INV-9 — random parent/child mandates accepted by `isWithin` never allow a request the parent denies; random revocation trees → all descendants inactive.
- **Integration:** approval lifecycle (create → Slack approve → retry succeeds → second retry fails because `maxUses = 1`); concurrent use of a 1-use mandate (P6); revoke parent during child's in-flight request (P4); Slack signature tampering rejected.
- **E2E:** agent over threshold → approval appears in Slack test workspace → approve → agent retry succeeds; agent creates a sub-agent with a bigger budget than it has → rejected with the violation list.
- **MCP:** run the MCP server against a local agent harness (e.g. Claude Code or the MCP Inspector) and exercise every tool.

## Security checklist

- [ ] Slack requests verified; Slack user ↔ member mapping requires verified email
- [ ] Nobody can approve their own request (test)
- [ ] Mandate signing keys encrypted; JWKS exposes public keys only
- [ ] Agent keys can create sub-agents only within their own mandate; can't approve anything
- [ ] Every approval/denial/mandate change in the audit chain

## Deployment

Slack app credentials in staging secrets; `/.well-known` route public; approvals expiry and suggestions jobs enabled.

## Try it yourself

1. Policy on Marketing: "approval over USD 1". As the research-bot agent:
   ```bash
   pnpm try:gateway --key apk_test_… --model anthropic/claude-sonnet-5 --max-tokens 60000
   ```
   → `aperture_approval_required` with an `approval_id`.
2. In Slack (test workspace) the Finance user sees the request → **Approve**. The requester in the same Slack/approving is refused (SoD).
3. Retry with `--approval <id>` → succeeds; retry again → denied (used).
4. With the SDK: `mandates.createSubAgent({ budget: "0.20", models: ["openai/gpt-4o-mini"], expiresIn: "2h" })` → new key; use it; then try creating one with USD 100 → rejected with violations.
5. Revoke the parent mandate in the UI → the sub-agent's next call fails.
6. Export a mandate's JWS and run `pnpm mandate-verify <jws> --jwks https://staging-app.<domain>/.well-known/aperture/orgs/<id>/jwks.json` → valid.

## Exit criteria

- [ ] Approval loop works via dashboard, email, and Slack
- [ ] INV-9 passes at 10,000+ cases nightly
- [ ] SDK and MCP published (private npm or GitHub Packages) with READMEs and examples

## Risks / open questions

- Many GCC organizations use Microsoft Teams rather than Slack. Ask the design partner early; if they use Teams, add a Teams adapter on the same approval core.
