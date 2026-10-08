# Phases 11 and 12: the build checklist

Started 2026-10-08, **code complete 2026-10-08**. Production deployment is on hold until after Phase 16, so everything here is built and tested locally (Testcontainers Postgres) and runs on staging. Each box is ticked only when the code, its tests, and its docs are in the repository.

Plans: [Phase 11](phase-11-posture-inventory-attestation/README.md) · [Phase 12](phase-12-seats-and-tools/README.md)

## Decisions taken while building (differences from the plans)

| # | Decision | Why |
|---|---|---|
| D11-1 | The AI tool and merchant catalogue lives in code (`packages/core/src/ai-tools.ts`), not in an `ai_tools` table | It's reference data that changes with releases, and the browser needs it for statement matching without an API call |
| D11-2 | Attestation PDFs are rendered on download from the signed JSON by a small built-in PDF writer, not stored and not built with `@react-pdf/renderer` | No new heavy dependency or licence review; the JSON stays the only record of truth; nothing to keep in object storage |
| D11-3 | Attestations are built in the request, not in a background job | A month of one org's audit chain builds in well under a second; a job queue adds nothing yet. The `attestations.status` column keeps room for a job later |
| D11-4 | The posture catalogue ships as version 1 and already includes the Phase 12 checks | Both phases ship together; no customer ever saw a version without them |
| D12-1 | Terminal telemetry accepts OTLP over HTTP with JSON (`http/json`) only | Claude Code supports `http/json`; a protobuf decoder for one signal isn't worth a dependency. Protobuf gets a clear 415 |
| D12-2 | Codex and Gemini CLI telemetry are deferred | Their metric names couldn't be confirmed from their docs; `@aperture/connect` says so instead of writing an unverified config |
| D12-3 | ChatGPT Business/Enterprise and Gemini in Workspace come in through a **seat CSV import** (their admin consoles export member lists) instead of API connectors | No public seat API could be confirmed for ChatGPT Business, and the Enterprise Compliance API and Google's Gemini report names couldn't be verified. Connectors are built where the docs were confirmed: Cursor, Claude Enterprise, Claude Code (Admin API), GitHub Copilot, Microsoft 365 Copilot |
| D12-4 | Forwarded receipts are trusted when the sender is a verified member of the org, or when the inbound provider reports a DKIM pass for the vendor's domain; everything else goes to review | A hand-forwarded receipt has the member as sender, so the vendor's DKIM can't survive. Receipts only add visibility (INV-17), so the risk of a forged one is low |
| D12-5 | Inbound email arrives as raw RFC 822 at one signed webhook (`POST /webhooks/inbound-email`, HMAC with `INBOUND_EMAIL_SECRET`), plus `.eml` upload in the dashboard | Works with any provider that can forward raw mail (Cloudflare Email Workers, Postmark, Resend) and testable today without a domain |

## Phase 11: posture, inventory, shadow AI, attestations, agent cards

### Database
- [x] `principals`: `purpose`, `data_classes`, `risk_tier` columns
- [x] `posture_runs`, `posture_waivers`
- [x] `statement_uploads`, `external_spend` (unique dedupe hash per org)
- [x] `attestations`, `attestation_shares`, `platform_signing_keys`
- [x] Migration + snapshot generated with drizzle-kit; security migration: RLS (tenant isolation) on every org table, grants to `aperture_app`, global key table without RLS
- [x] `collectPostureSnapshot` in `@aperture/db`, reading no secret columns

### Core (pure, `@aperture/core`)
- [x] RBAC permissions: `posture.read`, `posture.waive`, `inventory.read`, `external_spend.import`, `attestation.create`, `attestation.read` with the grants from the plan
- [x] AI tool / merchant catalogue (~45 vendors: descriptors, sender domains, plans, prices marked VERIFY, provider mapping)
- [x] Descriptor matcher (precision/recall test on a labelled fixture)
- [x] CSV parser (RFC 4180, quotes, BOM, `;` and `,` separators), column guessing, amount and date parsing, formula-injection escaping for exports
- [x] Posture catalogue v1 (all checks from 11.1 + `agents.high_risk_hard_capped` + Phase 12 checks), `evaluatePosture`, score and grade
- [x] Coverage computation (shares sum to 100%)
- [x] Attestation document type, canonical build, verification helper; minimal PDF writer

### API (`apps/api`)
- [x] `GET /posture` (latest run + catalogue), `POST /posture/runs` (rate-limited 1/min/org), `GET /posture/runs`
- [x] `GET/POST /posture/waivers`, `DELETE /posture/waivers/{id}` (reason + expiry ≤ 180 days, audited)
- [x] `GET /inventory` (rows with governance status, team filter for team leads, **and the coverage figure in the same response** instead of a separate `/inventory/coverage`), `GET /inventory.csv`
- [x] Credential claim through the existing assign route, now audited with the previous holder and the unassigned-history note
- [x] `POST /external-spend/uploads` (re-validates and re-matches every row, size limits, dedupe, `provider_billing` tagging), `GET /external-spend`, `PATCH /external-spend/{id}` (assign, govern, dismiss)
- [x] `POST /attestations`, `GET /attestations`, `GET /attestations/{id}`, `GET /attestations/{id}/pdf`, shares create/revoke, public share view (rate-limited, audited), `/.well-known/aperture/jwks.json`
- [x] Agent card: `GET /agents/{id}/card`, `GET /agents/{id}/card.jws` (both gated by `inventory.read`, so team leads see only their team), `PATCH /agents/{id}/governance` for purpose, data classes, risk tier (risk tier owner/admin only)
- [x] OpenAPI regenerated (`docs/api/openapi.json`) and web types regenerated

### Gateway / MCP / SDK
- [x] `get_agent_card` MCP tool and SDK method (gateway route `/v1/aperture/card`)

### Jobs
- [x] `posture.run` daily: run per org, diff, alert on new critical/high failures and waivers expiring within 7 days
- [x] Alert messages for `posture_regression`, `waiver_expiring`

### Web
- [x] Posture page (score, grade, failures by severity, fix links, waive dialog, history)
- [x] Inventory page (coverage bar, filters, CSV export)
- [x] Shadow AI page (unassigned keys with claim, statement upload parsed in the browser, external rows with resolve actions)
- [x] Attestations page (create, list, download JSON/PDF, share links)
- [x] Public `/verify` page (client-side JWS check against published JWKS, optional audit export recompute) and shared attestation page
- [x] Agent card page `/agents/{id}`, linked from Agents and Inventory; purpose/risk editing
- [x] Navigation entries and first-score onboarding notice

### CLI
- [x] `pnpm attestation-verify att.json [--audit audit.jsonl] [--jwks jwks.json]`

### Tests
- [x] Unit: every check (pass/fail/unknown/n.a.), score arithmetic, matcher precision ≥ 0.98 / recall ≥ 0.9 on the fixture, CSV parser on five bank formats
- [x] Property: `evaluatePosture` deterministic; adding a control never lowers the score; coverage sums to 100%
- [x] Fuzz: CSV parser with malformed rows, formula payloads, odd encodings
- [x] Integration: snapshot reads no secret columns; RLS on new tables; INV-16 (statement import changes no ledger/hold/usage row); waivers expire; daily run alerts only on new failures
- [x] Attestation: sign → verify; one flipped byte fails; verification after key rotation; Merkle root matches the CLI; broken chain reported; works after request-log retention
- [x] Agent card: no secrets in JSON; team-lead isolation; signed card verifies; risk-tier change audited

### Docs
- [x] ADR 0020 (attestation signing key, posture catalogue, INV-16)
- [x] Edge cases V1–V16 written into `plan/edge-cases`
- [x] Runbook: platform attestation key rotation
- [x] Guide: posture and attestations

## Phase 12: seats, subscriptions, terminal tools

### Database
- [x] `seats`, `seat_usage_daily`, `receipts`, `tool_usage_daily`, `telemetry_tokens`, `approved_tools`, `tool_confirmations`
- [x] `org_settings`: `receipts_token`, `idle_seat_days`
- [x] RLS + grants for every new table

### Core
- [x] RBAC: `seats.read`, `seats.manage`, `receipts.review`, `tools.declare` (every role, own), `telemetry.manage`
- [x] Receipt parser: templates for OpenAI, Anthropic, Cursor, GitHub, Midjourney, Perplexity, Google, Microsoft, ElevenLabs, Runway; plus a generic fallback that only goes to review
- [x] Minimal MIME reader for `.eml` (headers, multipart, quoted-printable, base64, charset)
- [x] OTLP JSON metric mapping for Claude Code (pinned to the documented metric names)
- [x] Seat insights: idle, duplicate, consolidate, seat-vs-API, unapproved tool (savings never negative)

### Connectors (`@aperture/connectors`, read-only seat capability)
- [x] Cursor Admin API (`/teams/members`, `/teams/daily-usage-data`, `/teams/spend`)
- [x] Claude Enterprise Analytics API (`/v1/organizations/analytics/users`)
- [x] Claude Code Analytics (Admin API `/v1/organizations/usage_report/claude_code`)
- [x] GitHub Copilot (`/orgs/{org}/copilot/billing/seats`)
- [x] Microsoft 365 Copilot (Graph `getMicrosoft365CopilotUsageUserDetail`, client-credentials token)
- [x] Seat CSV import (ChatGPT, Gemini, anything else)
- [x] Fakes and contract tests for each

### API
- [x] Seat connections: create/test/sync/delete reuse the connections table with `seat:` providers
- [x] `GET /seats`, `POST /seats` (manual), `PATCH /seats/{id}`, `POST /seats/import` (CSV rows), `GET /seats/insights`
- [x] `GET /tools` (catalogue + approved), `PUT /tools/approved`
- [x] `GET/PUT /me/tools`, `POST /me/tools/confirm`
- [x] Receipts: the address comes with `GET /me/tools` (`receiptsAddress`), `POST /me/receipts` (.eml), `GET /receipts`, `POST /receipts/{id}/resolve`; signed inbound webhook
- [x] Telemetry tokens: create (shown once), list, revoke; `GET /tool-usage`
- [x] Offboarding hook: removing a member revokes their telemetry tokens and flags their seats

### Gateway
- [x] `POST /otlp/v1/metrics` and `/otlp/v1/logs` (JSON only; telemetry token auth; size and rate limits; prompt-carrying attributes dropped; logs and traces accepted and dropped unread)
- [x] Telemetry tokens can't call model routes (test)

### Jobs
- [x] `seats.sync` every 6 h per seat connection
- [x] Daily `seats.idle` (idle/active status, also after every sync) and `seats.overage` (extra-usage alert); insights are computed on request. `GET/PUT /settings/seats` sets the idle threshold and the overage alert

### Packages and integrations
- [x] `@aperture/connect` CLI (`claude-code` target, shows diff, asks, `--undo`, `--yes`)
- [x] Claude Code plugin in `integrations/claude-code-plugin/` (manifest, remote MCP with user-config token, skills `budget-check` and `spend-approval`, marketplace file); passes `claude plugin validate`
- [x] Managed-settings templates (visibility mode, governed mode) in `docs/guides/claude-code.md`

### Web
- [x] Seats page (by tool, payer, status, insights, connections, CSV import)
- [x] Tools page (approved list, declarations overview)
- [x] My AI tools page for every member (declare, confirm, telemetry token, receipts address)
- [x] "Connect your AI tools" onboarding after accepting an invitation
- [x] Receipts review queue

### Tests
- [x] Unit: each receipt template, MIME edge cases, OTLP mapping, insight arithmetic
- [x] Property: dedupe idempotent; coverage still sums to 100% with seats
- [x] Fuzz: OTLP JSON decoder, MIME reader
- [x] Integration: INV-17 (seat/receipt imports touch no ledger row); telemetry token can't call models; prompt attributes never stored; RLS on new tables; offboarding revokes tokens
- [x] Contract: each seat connector against its fake

### Docs
- [x] ADR 0021 (seat model, telemetry privacy, receipts minimisation)
- [x] Edge cases S1–S9 (S9: idle seats)
- [x] Guides: Claude Code telemetry and governed mode, receipts inbox, seats
- [x] Privacy notice / sub-processors updated for seat lists, receipt fields, telemetry metrics
- [x] `plan/your-checklist.md`: owner steps for the inbound email domain and seat connector credentials

## Found and fixed while checking the build

- **Team leads could read every agent's card** (spend, keys, audit events) because the routes used `agents.read`, which team leads hold org-wide. They now follow `inventory.read`, as the plan says; tested.
- **Seats never became idle.** Nothing set `status = 'idle'`, so the idle filter was always empty. Added `refreshSeatIdleness`, the daily `seats.idle` job, and a refresh after every sync; tested.
- **The overage alert could never fire,** and the idle threshold couldn't be changed: no API set `extra_usage_alert` or `idle_seat_days`. Added `GET/PUT /settings/seats` and a Settings card on Seats; tested.
- **A connector seat plus a team-plan receipt counted twice** (S2). The receipt now attaches to the connector's seat as evidence; a personal plan stays separate so "paid twice" still shows; tested.
- **`/verify` accepted any document signed by the platform key,** including agent cards. It (and the new CLI) now checks the JWS `typ` and the payload `type`; tested.
- **`admin rotate-kek` skipped `platform_signing_keys`.** Removing the old KEK after a rotation would have broken attestation signing. Fixed and run against Postgres; `admin rotate-attestation-key` added with its runbook.
- The WIP commit didn't pass lint, format or knip, and the MCP and crypto tests failed; all fixed.

## Not done (and why)

- **E2E (Playwright) flows** from the Phase 11 and 12 plans: not written yet. Every flow is covered at API level against real Postgres.
- **V13 performance** (p95 < 2 s posture snapshot for 10k agents): not measured; goes with the Phase 13 load work.
- **Telemetry diagnostics view** for unknown metric names (S7) and an **abnormal-volume alert** (S5): not built; unknown metrics are ignored and tokens are rate-limited.
- **Quarterly declaration reminder email:** not built; `tools.declaration_fresh` already measures freshness.
- **12.9 subscriptions on a governed card:** waits on Stripe Issuing (D5).
- **Framework mapping (11.6):** optional, only on a design partner's request.

## Finish
- [x] `pnpm check` green (format, lint, typecheck, tests, knip, legacy imports)
- [x] Plan README status, phase READMEs status, roadmap updated
- [ ] Commits pushed to `origin/main` — **blocked:** this session's GitHub access refuses pushes (403); the work is committed on `claude/loving-babbage-oxr0f4`
