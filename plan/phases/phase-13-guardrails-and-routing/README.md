# Phase 13 — Runtime guardrails and budget-aware routing

**Goal:** catch runaway spend in minutes instead of at the end of the month, and stop work less often by stepping down to a cheaper model before a budget runs out. Everything stays a policy decision, recorded in the audit log.

1. **Rate limits an admin can set** per agent, key, and team, in requests and tokens per minute.
2. **Anomaly detection** on the ledger: spikes, runaway loops, a key suddenly busy, a model never used before.
3. **Budget-aware routing:** model ceilings, task-class routing, and a "soft landing" that downgrades the model as a budget fills, keeping each session on one model so prompt caching still works.
4. **Paid tools and remote MCP servers** governed by the same policies.

**Duration:** ~3 weeks.
**Depends on:** Phases 5, 7, and 9 (gateway, policy engine, approvals, x402). Phase 12 is not required.
**Needs from you:** nothing.

## Why this phase

- LiteLLM, Portkey, and the cloud gateways sell per-key rate limits and routing. Buyers expect them from anything called a gateway.
- Finout and the FinOps tools sell anomaly detection. We already hold the data in real time, so we can act on it (pause, require approval), not just report it.
- Prompt-based routing ("NLP routing") is a commodity: OpenRouter Auto, Not Diamond, Martian, RouteLLM (open source), LiteLLM Auto Routing, Azure Model Router, Bedrock prompt routing. **Budget-aware routing** is ours: only the product that owns the budget can step down a model at 80% of it and prove why.

## Starting point

- `apps/gateway/src/limits.ts`: an in-process limiter with fixed defaults (20 concurrent per key, 100 per org, 600 requests per minute per key). It isn't configurable, has no token limits, and each instance counts separately.
- Policy rules in `packages/core/src/policy/schema.ts`: `allow_models`, `deny_models`, `allow_providers`, `deny_providers`, `max_amount_per_action`, `max_output_tokens`, `approval_threshold`, `time_window`, `x402_payees`, `prompt_logging`, and others. `evaluate` returns `pass`, `deny`, or `approval`.
- Ledger, `gateway_requests`, the kill switch, approvals, alert channels, pg-boss.
- The gateway is a **passthrough without model translation** (key decision 4). Routing can only substitute a model that speaks the same API format.

## Scope

**In:** a `rate_limit` policy rule with token limits; shared limiter state; anomaly detectors with actions; `route` policy rules (ceiling, task class, soft landing) with session stickiness; a router plug-in interface; a remote MCP proxy with tool-level rules; a savings report.

**Out:** translating between API formats (OpenAI ↔ Anthropic) to route across providers; prompt-content guardrails such as PII masking and prompt-injection detection (LiteLLM and others give these away; revisit only if the pilot asks); response caching and prompt compression; local (stdio) MCP servers.

## Tasks

### 13.1 Configurable rate limits

- New policy rule `rate_limit`: `{ rpm?, tpm?, concurrency?, scope: 'principal' | 'key' | 'team' }`. It resolves like other rules (org → team → principal; the strictest wins).
- **Token limits** count input tokens estimated before the call (from the request) and correct after the response with real usage, so a long stream can't dodge them.
- **Shared state:** counters move from process memory to Postgres (one row per scope and minute, `INSERT … ON CONFLICT DO UPDATE`), with a short in-process cache so most requests don't hit the database. **Decision for ADR 0022:** if the 30 ms gateway overhead budget is missed under load, add Redis/Valkey (Memorystore on GCP). Measure first.
- Over the limit → `429` with `Retry-After`, an audit event (sampled after the first per minute), and the existing defaults kept as a safety floor.

### 13.2 Anomaly detection

A worker job every 5 minutes, per org, on `ledger_entries` and `gateway_requests` (no prompt content):

| Detector | Rule (defaults are org settings) |
|---|---|
| Spend spike | Spend in the last hour > 4× the same hour-of-week median over 4 weeks **and** > USD 5 |
| Runaway loop | One key or agent making > 3× its normal request rate with near-identical request sizes for 10+ minutes |
| New model | A principal uses a model it has never used, priced > 3× its usual model |
| New origin | A key used from an IP range or country not seen in 30 days |
| Off-hours burst | Spend outside the org's working hours > N× normal (uses `time_window` data) |
| Budget burn | Projected to exhaust the period's budget before 70% of the period has passed |

- **Actions**, chosen per detector: `alert` (default), `require_approval` (the principal's next requests go to approval until a human clears it), or `pause` (kill switch on that key or agent). Every action and every clear writes an audit event.
- **Noise control:** minimum absolute amounts, a cooldown per subject, and grouping of alerts. New orgs get 7 days of learning before any non-alert action fires.
- Shown on the agent card (Phase 11) and as posture check `anomaly.actions_configured`.

### 13.3 Budget-aware routing (`route` rules)

Opt-in per policy. A client that names a model gets that model unless a `route` rule says otherwise.

- **Model ceiling:** `{ type: 'route', ceiling: { tier: 'standard' } }`. Models in the price catalogue get a tier (`economy`, `standard`, `premium`); a request above the ceiling is mapped to a model the admin chose at or below it, or denied if none is mapped.
- **Task class:** clients may send `X-Aperture-Task: background | batch | interactive`. Rules map classes to models, for example all `batch` work to an economy model.
- **Soft landing:** `{ downgrade_at: 0.8, map: { 'claude-opus-…': 'claude-sonnet-…' } }`. When the budget on the request's path passes 80%, the mapped model is used; at 100% the hard budget still denies. Each step can alert.
- **Session stickiness:** the routing decision is fixed for a session (`X-Aperture-Session`, or a hash of key + conversation prefix when the client sends none) for up to 24 h. Switching models in the middle of a conversation throws away the provider's prompt cache and can cost more than it saves.
- **Same format only:** mappings must stay within one API format (Anthropic → Anthropic, OpenAI-compatible → OpenAI-compatible, including OpenRouter model ids). The rule editor refuses others.
- Every routed response carries `X-Aperture-Model-Requested` and `X-Aperture-Model-Served`, and both go in `gateway_requests` and the audit event. Reserve uses the served model's price.

### 13.4 Router plug-ins (optional, only if the pilot asks)

- A `RouteStrategy` interface: given the request metadata (and the prompt, only if the org opts in), return a model from an allowed set.
- Adapters: a self-hosted RouteLLM-style classifier, or an external router API such as Not Diamond. An external router means prompts leave to a third party, so it needs an explicit org setting, a sub-processor entry, and a DPA. **VERIFY** the vendors' terms and latency.
- Plug-ins can only choose inside what `route` rules allow, and session stickiness still applies.

### 13.5 Paid tools and remote MCP servers

- New policy rule `mcp_tools`: allow or deny remote MCP servers and individual tools per principal (`server: 'https://…', tools: ['create_issue']`).
- Gateway route `/mcp/{serverId}` proxies **remote (HTTP) MCP servers** registered by an admin. It checks the rule on each `tools/call`, records an audit event per call, and, when the tool is paid (x402 or a priced tool), reserves and settles through the ledger like any other spend.
- Agents connect to Aperture's URL instead of the server's URL. Local stdio servers are out of scope (they would need a local agent on each machine).

### 13.6 Savings report

- Per period: spend avoided by routing (requested model price minus served model price), by anomaly actions (estimated from the pre-action rate), and by rate limits. Labelled "estimated".
- Feeds the Phase 14 finance reports and the attestation.

## Edge cases

- **G1** Two gateway instances share one limit → Postgres counters keep the total right; a brief overshoot of at most the cache window is documented.
- **G2** Soft landing triggers in the middle of a session → the session keeps its model; only new sessions are routed down.
- **G3** The mapped cheaper model is down → fall back to the original model if the budget allows, else deny; never route to an unmapped model.
- **G4** A client depends on a model-specific feature (tools, vision) the mapped model lacks → the catalogue records capabilities; mappings that lose a required capability are refused at save time, and requests needing it skip routing.
- **G5** An anomaly fires on a legitimate launch day → the admin clears it with a reason, which is audited; an "expected event" window suppresses that detector.
- **G6** A detector job falls behind → it processes by time window, never skips; lag is a metric with an alert.
- **G7** An MCP server changes its tool list → unknown tools are denied until an admin allows them.

## Tests

- **U:** rule resolution for `rate_limit` and `route` (strictest wins); tier mapping; each detector on synthetic series (fires, doesn't fire, cooldown).
- **P:** routing never picks a model outside the allowed set; soft landing never increases price; with stickiness, one session never sees two models; rate-limit counters never go negative.
- **I:** two gateway processes against one Postgres respect a shared limit within tolerance; `require_approval` from a detector actually sends the next request to approval; MCP `tools/call` denied for an unlisted tool, with an audit event.
- **Load (k6):** gateway overhead p99 still < 30 ms with rate limits and routing on (Phase 5 target).
- **E:** set a soft landing at 80% → push spend past it on a fake upstream → new sessions get the cheaper model, response headers show both models.

## Security checklist

- [ ] Rate-limit and routing decisions fail closed (deny) if policy can't be read
- [ ] Prompts are never sent to an external router without the org opt-in, and that opt-in is audited
- [ ] The MCP proxy only reaches servers on the admin's list (no open proxy; reuse the SSRF guard)
- [ ] Detector actions can't be triggered by a member against someone else's agent
- [ ] Routing headers don't reveal other orgs' data or internal model mappings beyond the two model ids

## Deployment

Migrations for `rate_limit_counters`, `anomaly_events`, `anomaly_settings`, `route_sessions`, `mcp_servers`. A worker job `anomaly.scan` (every 5 minutes). If ADR 0022 picks Redis/Valkey, add it to the GCP plan and `compose.prod.yml`. No other new services.

## Try it yourself

1. Give a test agent `rate_limit: { rpm: 5 }` → the sixth request in a minute returns `429`.
2. Run a loop that calls the fake upstream for 15 minutes → an anomaly fires; with `require_approval`, the next request waits for approval in Slack or the dashboard.
3. Add a soft landing at 80% with an Opus → Sonnet mapping (via OpenRouter, within the USD 1 test cap) → after spend passes 80%, a new session reports `X-Aperture-Model-Served: …sonnet…`.
4. Register a remote MCP test server, allow one tool → calling the other tool is denied and audited.

## Exit criteria

- [ ] `rate_limit` rules with token limits, shared across instances, within the latency budget
- [ ] Six detectors live with alert, approval, and pause actions, and a learning period
- [ ] Ceiling, task-class, and soft-landing routing with session stickiness; requested and served model in every record
- [ ] Remote MCP proxy with tool-level rules
- [ ] Savings report; ADR 0022 written
