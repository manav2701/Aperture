# Phase 12 — Seats, subscriptions, and terminal tools

**Goal:** see the AI that never touches an API key. Most companies use AI mainly through **seats**: ChatGPT Business/Enterprise, Claude Team/Enterprise, Cursor, GitHub Copilot, Microsoft 365 Copilot, Gemini in Workspace, personal ChatGPT Plus or Claude Pro plans people expense, and terminal tools such as Claude Code, Codex, and Gemini CLI logged in with a subscription. None of that passes through our gateway, so today Aperture can't see it.

After this phase an org can answer:
1. **Who has which AI seat, who pays for it, and is it used?**
2. **Who pays for AI personally or on cards nobody approved?**
3. **What do developers spend through terminal tools, even on a subscription?**
4. **Where would moving people between seats and governed API billing save money?**

**Duration:** ~3.5 weeks.
**Depends on:** Phase 11 (inventory, coverage figure, AI merchant catalogue, `external_spend`, posture engine).
**Needs from you:** nothing to build it. To test the seat connectors live you need admin access to a workspace of that product (your own Claude Team or ChatGPT Business workspace is enough). Every connector is built and tested against fakes first.

## Why this phase

- **Coverage would be a lie without it.** Phase 11's coverage figure only counts what we can see. A company with 40 ChatGPT seats and a small OpenAI API bill would score "95% enforced" when most of its AI use is ungoverned.
- **It's day-one value for the pilot with no keys handed over.** "You pay for 40 seats, 11 are idle, 3 people expense Midjourney, and here is Claude Code cost per developer" is concrete in the first week.
- **Seat savings are the easiest ROI to prove.** Reclaiming an idle seat is money back next month.

**What this phase is not.** On a flat-price seat we can't meter or block single messages, and we never log in to a person's consumer account (it breaks the vendors' terms and would make us hold credentials). Seats are **visible**, never **enforced**, unless they are paid with a card Aperture governs (12.9).

## Starting point

- Phase 11: `external_spend`, the AI merchant catalogue (`packages/core/src/ai-merchants.ts`), coverage statuses (`enforced`, `visible`, `unassigned`, `external`), the posture engine and waivers.
- Connector registry and contract-test pattern (`packages/connectors/src/registry.ts`, fakes in tests).
- Gateway auth for scoped keys, the redacting logger, pg-boss jobs, alert channels.
- `@aperture/mcp` and `@aperture/sdk` (Phase 7).
- Resend for outbound email.

## Scope

**In:** an AI tool catalogue; seats and seat-usage tables; read-only seat connectors for six products; a receipts inbox; "My AI tools" self-declaration; an OpenTelemetry collector for terminal tools; `@aperture/connect` and a Claude Code plugin; managed-settings templates; seat insights and new posture checks; the "Connect your AI tools" onboarding screen.

**Out:** the browser extension (Phase 16); reading or storing conversation content; any login to consumer accounts; live bank feeds; Google Workspace or Microsoft 365 OAuth-grant discovery (Phase 15).

## Tasks

### 12.1 AI tool catalogue and seat model

- Extend the Phase 11 merchant catalogue into an **AI tool catalogue**: vendor, product, category (chat, coding, image, video, voice, API), plan tiers with list prices, pricing model (`seat`, `usage`, `seat_plus_usage`), and which plans have an admin API (`admin_api: none | analytics | compliance`). Statement and receipt matching both use it.
- New tables:
  - `seats` (`org_id`, `tool_id`, `plan`, `principal_id` (a user), `external_user_ref`, `source` = `connector` | `receipt` | `statement` | `declared`, `payer` = `company` | `personal_expensed` | `personal_unexpensed` | `unknown`, `monthly_cost` µUSD, `currency`, `renews_on`, `status` = `active` | `idle` | `cancelled`, `last_active_at`, `connection_id`).
  - `seat_usage_daily` (`seat_id`, `day`, `active` bool, `messages`/`requests`, `tokens` where the vendor reports them, `extra_usage_cost` µUSD for overage credits).
- **Invariant INV-17: seat and subscription costs never touch `ledger_entries`, `holds`, or `budget_usage`** (same rule as INV-16). They appear in inventory, coverage, posture, attestations, and the Phase 14 finance reports, always labelled by source. The one exception is a subscription paid through a governed card (12.9), whose authorizations already go through the ledger on the cards rail.
- Coverage (11.3): seats from an admin API count as `visible`; receipts, statements, and declarations count as `external`. Match people across sources by work email; a receipt from a personal address is matched only when the member confirms it.

### 12.2 Seat connectors (read-only)

A new connector capability `seats` in the registry. Each connector lists seats, maps users to members by email, and imports daily activity. All scopes are read-only, and each connector is contract-tested against a fake built from the vendor's docs.

| Product | Source (**VERIFY** endpoints, scopes, and which plan unlocks them when the phase starts) | Order |
|---|---|---|
| ChatGPT Business / Enterprise | Workspace user list and analytics; Compliance API on Enterprise | 1 |
| Claude Team / Enterprise | Admin user list and usage analytics; Compliance API on Enterprise; Claude Code usage reports for API organizations | 2 |
| Cursor (Teams) | Admin API: members, usage events, spend | 3 |
| GitHub Copilot | Seat management and Copilot metrics REST APIs | 4 |
| Microsoft 365 Copilot | Microsoft Graph Copilot usage reports | 5 |
| Gemini in Google Workspace | Admin SDK Reports API | 6 |

- Where a vendor has no API for something (for example seat price), the admin types it once on the connection.
- Overage and usage-based extras (ChatGPT credits, Cursor usage pricing, Claude extra usage) are imported as `extra_usage_cost` when reported, and can have an alert threshold. We can't cap them. The insight links to the vendor's own spend-limit setting.
- Build 1–3 first and stop if the pilot doesn't use 4–6.

### 12.3 Receipts inbox

- Every org gets an inbound address, for example `receipts-<slug>@in.<domain>`. Members forward receipt emails or set a mail rule. **VERIFY** Resend inbound email (or use another inbound provider) once the domain exists.
- The parser is deterministic: one template per top vendor (OpenAI, Anthropic, Cursor, Midjourney, Perplexity, GitHub, Google, Microsoft, ElevenLabs, Runway), keyed on the sender domain plus a DKIM pass. It extracts vendor, plan, amount, currency, date, and renewal. Anything else goes to a **review queue** in the dashboard. No LLM is used for parsing in v1.
- The forwarding member is the presumed seat holder; they confirm or reassign it in one click.
- **Data minimisation:** after extraction, the email body and attachments are discarded. We keep only the extracted fields plus a SHA-256 of the message for deduplication. Mail from senders that aren't in the catalogue is dropped unread, with a count shown to the admin.
- Rows become `seats` (for subscriptions) or `external_spend` (for one-off purchases).

### 12.4 "My AI tools" self-declaration

- A workspace page where each member picks tools from the catalogue, the plan, and who pays (`company card`, `I pay and expense it`, `I pay personally`). It takes about 20 seconds.
- **Quarterly confirmation:** a reminder asks each member to confirm their list. Confirmation rates appear in posture (`tools.declaration_fresh`) and in the attestation.
- Admins keep an **approved tools** list in org settings. Declaring an unapproved tool is allowed (we want honesty, not hiding) and shows as an insight, not a punishment.

### 12.5 OpenTelemetry collector for terminal tools

- New ingest endpoints on the gateway: `POST /otlp/v1/metrics` and `POST /otlp/v1/logs` (OTLP over HTTP, protobuf and JSON). They authenticate with a new **telemetry token**: a key type scoped to one member and one tool. It can only send telemetry and can't call models or the API.
- **Claude Code** sends metrics such as sessions, tokens by type, cost, and code activity, with the user's identity, whether it's logged in with an API key or a subscription. **Codex** and **Gemini CLI** have OpenTelemetry support too. **VERIFY** the metric and attribute names for each tool and pin a mapping per tool version.
- Stored as `tool_usage_daily` (`member`, `tool`, `day`, `sessions`, `input_tokens`, `output_tokens`, `cache_tokens`, `estimated_cost` µUSD, `model`). For subscription users the cost is shown as **"list-price equivalent"**: what this usage would cost on the API. That's the number that decides seat vs. API.
- **Privacy:** we accept metrics and only the log events we need for session counts. Event attributes that can carry prompt text or tool input are dropped at ingest, even if the client sends them. The templates in 12.6 leave prompt logging off.
- Rate limit and size limit per token; reject unknown metric names quietly.

### 12.6 `@aperture/connect`, the Claude Code plugin, and managed settings

- **`npx @aperture/connect <tool> --token <telemetry token>`** writes the telemetry settings into the tool's user config (Claude Code, Codex, Gemini CLI), shows the diff, and asks before writing. `--undo` removes them.
- **Claude Code plugin** (one install, **VERIFY** what a plugin can set): the `@aperture/mcp` server (budget left, request budget, agent card), telemetry settings, and an optional hook that asks for an approval before steps the org marks as expensive. Listed in a plugin marketplace once published (Phase 15 handles listings).
- **Managed-settings templates** for admins who deploy settings to every machine (**VERIFY** file paths per OS and which keys can be enforced):
  - **Visibility mode:** telemetry to Aperture, prompt logging off. Works with subscription logins.
  - **Governed mode:** for companies on API billing, Claude Code is pointed at the Aperture gateway (`ANTHROPIC_BASE_URL`) with a short-lived Aperture key fetched by a key helper, so every developer gets their own budget, policy, and audit trail. Codex gets the equivalent custom-provider config where it supports one.
  - **Model rules:** pin the default and the fast model per org. This works even without the gateway.
- Docs page per tool with copy buttons; the dashboard shows which members are reporting.

### 12.7 Seat insights and posture checks

Insights (each with an estimated monthly saving and an action):
- **Idle seat:** no activity for 30 days (threshold is an org setting) → "reclaim" links to the vendor's admin page.
- **Duplicate:** a member has a company seat and also expenses a personal plan of the same or an overlapping tool.
- **Consolidate:** N people expense personal plans of one vendor → cost of a team plan vs. today, plus the data point that team plans come with admin controls. **VERIFY** current team-plan prices.
- **Seat vs. API:** from 12.5 telemetry, members whose list-price-equivalent usage is far below the seat price (API is cheaper) or far above it (keep the seat).
- **Unapproved tool** in use.

New posture checks (catalogue v2): `seats.idle`, `seats.personal_duplicates`, `tools.unapproved`, `tools.declaration_fresh`, `telemetry.coverage` (share of developers on coding seats who report telemetry), `seats.extra_usage_alert` (overage has an alert threshold).

### 12.8 "Connect your AI tools" onboarding

- After a member accepts an invitation, they land on one screen with three actions: **Forward receipts** (shows their address and a mail-rule guide for Gmail and Outlook), **Connect Claude Code / Codex** (shows the `@aperture/connect` command with their token), and **Declare your tools** (12.4). The browser extension button appears after Phase 16.
- Each takes under a minute. The admin sees the org's coverage rise as members finish.

### 12.9 Moving a subscription onto a governed card (needs the cards rail)

- From any seat or external row: "Move to company card" issues a merchant-locked virtual card with a monthly cap through the Phase 8 task-card flow, and the member moves their subscription onto it. The seat becomes `enforced`, renewals become visible, and revoking the card cancels it.
- Built behind a feature flag. It only works once Stripe Issuing is available (decision D5).

### 12.10 Permissions and dashboard

| Permission | owner | admin | finance | team_lead | member | auditor |
|---|---|---|---|---|---|---|
| `seats.read` | ✓ | ✓ | ✓ | ✓ (own team) | own seats | ✓ |
| `seats.manage` (connectors, approved tools, reassign) | ✓ | ✓ | ✓ | | | |
| `receipts.review` | ✓ | ✓ | ✓ | | own | |
| `telemetry.token.create` | ✓ | ✓ | | | own | |

Dashboard: **Seats** (by tool, payer, status, with insights), **Tools** (approved list, declarations), and per-member **My AI tools**. Seats also appear in Inventory and on the coverage bar.

## Edge cases

- **S1** A member leaves: their seats are flagged for reclaim on offboarding, and their telemetry token is revoked.
- **S2** The same seat comes from a connector and a receipt: the connector wins and the receipt is attached as evidence. No double counting.
- **S3** A receipt arrives in another currency: converted at that day's `fx_rates`; the original amount is kept.
- **S4** A forged receipt email: no DKIM pass for the vendor domain → review queue, never auto-imported.
- **S5** A telemetry token leaks: scoped to telemetry only; rotating it is one click; abnormal volume is rate-limited and alerted.
- **S6** The vendor API changes or the plan downgrades and the admin API disappears: connection goes `degraded`, posture shows `unknown`, seats are kept with `last_synced_at`.
- **S7** A tool's metric names change in a new version: unknown metrics are counted and surfaced in an admin diagnostics view; the mapping is versioned.
- **S8** A personal email on a receipt: matched only after the member confirms; the personal address isn't stored.

## Tests

- **U:** each receipt template on real-shaped samples (redacted), currency parsing, catalogue matching, insight arithmetic (savings never negative, thresholds respected), OTLP mapping per tool version.
- **P:** coverage shares still sum to 100% with seats; deduplication is idempotent (importing the same receipt or sync twice changes nothing).
- **F:** fuzz the OTLP decoder (protobuf and JSON) and the MIME parser (huge, nested, malformed messages).
- **I:** INV-17: seat imports change no row in `ledger_entries`, `holds`, or `budget_usage`. Telemetry tokens can't call any model route. Prompt-carrying attributes never reach the database (assert on stored rows). RLS on every new table.
- **Contract:** each seat connector against its fake; a weekly live run for the connectors you have workspaces for (spend is zero, it's read-only).
- **E:** forward a sample receipt → it appears as a seat; run `@aperture/connect` against a fake Claude Code config → telemetry arrives; idle seat insight appears after advancing the clock.

## Security checklist

- [ ] Seat connector credentials are read-only and envelope-encrypted like other credentials
- [ ] The inbound mail endpoint verifies the provider's webhook signature and DKIM; bodies are discarded after extraction
- [ ] Telemetry tokens are scoped, hashed at rest, revocable, and rate-limited
- [ ] No prompt text, tool input, or file content is stored from telemetry (test-enforced)
- [ ] `@aperture/connect` shows the change and asks before writing, and supports `--undo`
- [ ] The privacy notice and DPA list the new data (seat lists, receipt fields, telemetry metrics)

## Deployment

Migrations for `ai_tools`, `seats`, `seat_usage_daily`, `receipts`, `tool_usage_daily`, `telemetry_tokens`, `approved_tools`. Jobs: `seats.sync` (per connection, every 6 h), `seats.insights` (daily). OTLP routes on the gateway service. Inbound mail needs the domain (MX record on `in.<domain>`). `@aperture/connect` publishes with the SDK and MCP packages (Phase 15).

## Try it yourself

1. Connect your own Claude Team or ChatGPT Business workspace (if you have one) → **Seats** lists members, plan, and last activity.
2. Forward one of your own AI receipts to the inbox address → it appears as a seat with plan, amount, and renewal date.
3. Run `npx @aperture/connect claude-code --token …` on your machine, use Claude Code for a few minutes → **Seats → Claude Code** shows your sessions, tokens, and list-price-equivalent cost.
4. Declare a tool that isn't on the approved list → it shows as an insight; posture shows `tools.unapproved`.
5. Check the coverage bar on **Inventory**: seats now appear as `visible` or `external`.

## Exit criteria

- [ ] Seat connectors 1–3 live (others only if the pilot uses them), contract-tested on fakes
- [ ] Receipts inbox, self-declaration, and the onboarding screen working end to end
- [ ] Claude Code telemetry ingest working on a real machine; Codex and Gemini CLI mapped or explicitly deferred after VERIFY
- [ ] Insights and posture catalogue v2 live; INV-17 enforced by test
- [ ] ADR 0021 written (seat model, telemetry privacy, receipts data minimisation)
- [ ] The design partner has seen their seat list and at least one saving
