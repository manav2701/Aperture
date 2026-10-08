# Phases 11 and 12: the build checklist

Started 2026-10-08. Production deployment is on hold until after Phase 16, so everything here is built and tested locally (Testcontainers Postgres) and runs on staging. Each box is ticked only when the code, its tests, and its docs are in the repository.

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
- [ ] `principals`: `purpose`, `data_classes`, `risk_tier` columns
- [ ] `posture_runs`, `posture_waivers`
- [ ] `statement_uploads`, `external_spend` (unique dedupe hash per org)
- [ ] `attestations`, `attestation_shares`, `platform_signing_keys`
- [ ] Migration + snapshot generated with drizzle-kit; security migration: RLS (tenant isolation) on every org table, grants to `aperture_app`, global key table without RLS
- [ ] `collectPostureSnapshot` in `@aperture/db`, reading no secret columns

### Core (pure, `@aperture/core`)
- [ ] RBAC permissions: `posture.read`, `posture.waive`, `inventory.read`, `external_spend.import`, `attestation.create`, `attestation.read` with the grants from the plan
- [ ] AI tool / merchant catalogue (~45 vendors: descriptors, sender domains, plans, prices marked VERIFY, provider mapping)
- [ ] Descriptor matcher (precision/recall test on a labelled fixture)
- [ ] CSV parser (RFC 4180, quotes, BOM, `;` and `,` separators), column guessing, amount and date parsing, formula-injection escaping for exports
- [ ] Posture catalogue v1 (all checks from 11.1 + `agents.high_risk_hard_capped` + Phase 12 checks), `evaluatePosture`, score and grade
- [ ] Coverage computation (shares sum to 100%)
- [ ] Attestation document type, canonical build, verification helper; minimal PDF writer

### API (`apps/api`)
- [ ] `GET /posture` (latest run + catalogue), `POST /posture/runs` (rate-limited 1/min/org), `GET /posture/runs`
- [ ] `GET/POST /posture/waivers`, `DELETE /posture/waivers/{id}` (reason + expiry ≤ 180 days, audited)
- [ ] `GET /inventory` (rows with governance status, team filter for team leads), `GET /inventory/coverage`, `GET /inventory.csv`
- [ ] Credential claim through the existing assign route, now audited with the unassigned-history note
- [ ] `POST /external-spend/uploads` (re-validates and re-matches every row, size limits, dedupe, `provider_billing` tagging), `GET /external-spend`, `PATCH /external-spend/{id}` (assign, govern, dismiss)
- [ ] `POST /attestations`, `GET /attestations`, `GET /attestations/{id}`, `GET /attestations/{id}/pdf`, shares create/revoke, public share view (rate-limited, audited), `/.well-known/aperture/jwks.json`
- [ ] Agent card: `GET /agents/{id}/card`, `GET /agents/{id}/card.jws`, `PATCH /agents/{id}` accepts purpose, data classes, risk tier (risk tier owner/admin only)
- [ ] OpenAPI regenerated (`docs/api/openapi.json`) and web types regenerated

### Gateway / MCP / SDK
- [ ] `get_agent_card` MCP tool and SDK method (gateway route `/v1/aperture/card`)

### Jobs
- [ ] `posture.run` daily: run per org, diff, alert on new critical/high failures and waivers expiring within 7 days
- [ ] Alert messages for `posture_regression`, `waiver_expiring`

### Web
- [ ] Posture page (score, grade, failures by severity, fix links, waive dialog, history)
- [ ] Inventory page (coverage bar, filters, CSV export)
- [ ] Shadow AI page (unassigned keys with claim, statement upload parsed in the browser, external rows with resolve actions)
- [ ] Attestations page (create, list, download JSON/PDF, share links)
- [ ] Public `/verify` page (client-side JWS check against published JWKS, optional audit export recompute) and shared attestation page
- [ ] Agent card page `/agents/{id}`, linked from Agents and Inventory; purpose/risk editing
- [ ] Navigation entries and first-score onboarding notice

### CLI
- [ ] `pnpm attestation-verify att.json [--audit audit.jsonl] [--jwks jwks.json]`

### Tests
- [ ] Unit: every check (pass/fail/unknown/n.a.), score arithmetic, matcher precision ≥ 0.98 / recall ≥ 0.9 on the fixture, CSV parser on five bank formats
- [ ] Property: `evaluatePosture` deterministic; adding a control never lowers the score; coverage sums to 100%
- [ ] Fuzz: CSV parser with malformed rows, formula payloads, odd encodings
- [ ] Integration: snapshot reads no secret columns; RLS on new tables; INV-16 (statement import changes no ledger/hold/usage row); waivers expire; daily run alerts only on new failures
- [ ] Attestation: sign → verify; one flipped byte fails; verification after key rotation; Merkle root matches the CLI; broken chain reported; works after request-log retention
- [ ] Agent card: no secrets in JSON; team-lead isolation; signed card verifies; risk-tier change audited

### Docs
- [ ] ADR 0020 (attestation signing key, posture catalogue, INV-16)
- [ ] Edge cases V1–V16 written into `plan/edge-cases`
- [ ] Runbook: platform attestation key rotation
- [ ] Guide: posture and attestations

## Phase 12: seats, subscriptions, terminal tools

### Database
- [ ] `seats`, `seat_usage_daily`, `receipts`, `tool_usage_daily`, `telemetry_tokens`, `approved_tools`, `tool_confirmations`
- [ ] `org_settings`: `receipts_token`, `idle_seat_days`
- [ ] RLS + grants for every new table

### Core
- [ ] RBAC: `seats.read`, `seats.manage`, `receipts.review`, `tools.declare` (every role, own), `telemetry.manage`
- [ ] Receipt parser: templates for OpenAI, Anthropic, Cursor, GitHub, Midjourney, Perplexity, Google, Microsoft, ElevenLabs, Runway; plus a generic fallback that only goes to review
- [ ] Minimal MIME reader for `.eml` (headers, multipart, quoted-printable, base64, charset)
- [ ] OTLP JSON metric mapping for Claude Code (pinned to the documented metric names)
- [ ] Seat insights: idle, duplicate, consolidate, seat-vs-API, unapproved tool (savings never negative)

### Connectors (`@aperture/connectors`, read-only seat capability)
- [ ] Cursor Admin API (`/teams/members`, `/teams/daily-usage-data`, `/teams/spend`)
- [ ] Claude Enterprise Analytics API (`/v1/organizations/analytics/users`)
- [ ] Claude Code Analytics (Admin API `/v1/organizations/usage_report/claude_code`)
- [ ] GitHub Copilot (`/orgs/{org}/copilot/billing/seats`)
- [ ] Microsoft 365 Copilot (Graph `getMicrosoft365CopilotUsageUserDetail`, client-credentials token)
- [ ] Seat CSV import (ChatGPT, Gemini, anything else)
- [ ] Fakes and contract tests for each

### API
- [ ] Seat connections: create/test/sync/delete reuse the connections table with `seat:` providers
- [ ] `GET /seats`, `POST /seats` (manual), `PATCH /seats/{id}`, `POST /seats/import` (CSV rows), `GET /seats/insights`
- [ ] `GET /tools` (catalogue + approved), `PUT /tools/approved`
- [ ] `GET/PUT /me/tools`, `POST /me/tools/confirm`
- [ ] Receipts: `GET /receipts/address`, `POST /receipts/upload` (.eml), `GET /receipts`, `POST /receipts/{id}/resolve`; signed inbound webhook
- [ ] Telemetry tokens: create (shown once), list, revoke; `GET /tool-usage`
- [ ] Offboarding hook: removing a member revokes their telemetry tokens and flags their seats

### Gateway
- [ ] `POST /otlp/v1/metrics` and `/otlp/v1/logs` (JSON only; telemetry token auth; size and rate limits; prompt-carrying attributes dropped)
- [ ] Telemetry tokens can't call model routes (test)

### Jobs
- [ ] `seats.sync` every 6 h per seat connection
- [ ] `seats.insights` daily: idle status, extra-usage alert

### Packages and integrations
- [ ] `@aperture/connect` CLI (`claude-code` target, shows diff, asks, `--undo`, `--yes`)
- [ ] Claude Code plugin in `integrations/claude-code-plugin/` (manifest, remote MCP with user-config token, commands, marketplace file)
- [ ] Managed-settings templates (visibility mode, governed mode) in `docs/guides/claude-code.md`

### Web
- [ ] Seats page (by tool, payer, status, insights, connections, CSV import)
- [ ] Tools page (approved list, declarations overview)
- [ ] My AI tools page for every member (declare, confirm, telemetry token, receipts address)
- [ ] "Connect your AI tools" onboarding after accepting an invitation
- [ ] Receipts review queue

### Tests
- [ ] Unit: each receipt template, MIME edge cases, OTLP mapping, insight arithmetic
- [ ] Property: dedupe idempotent; coverage still sums to 100% with seats
- [ ] Fuzz: OTLP JSON decoder, MIME reader
- [ ] Integration: INV-17 (seat/receipt imports touch no ledger row); telemetry token can't call models; prompt attributes never stored; RLS on new tables; offboarding revokes tokens
- [ ] Contract: each seat connector against its fake

### Docs
- [ ] ADR 0021 (seat model, telemetry privacy, receipts minimisation)
- [ ] Edge cases S1–S8
- [ ] Guides: Claude Code telemetry and governed mode, receipts inbox, seats
- [ ] Privacy notice / sub-processors updated for seat lists, receipt fields, telemetry metrics
- [ ] `plan/your-checklist.md`: owner steps for the inbound email domain and seat connector credentials

## Finish
- [ ] `pnpm check` green (format, lint, typecheck, tests, knip, legacy imports)
- [ ] Plan README status, phase READMEs status, roadmap updated
- [ ] Commits pushed to `origin/main`
