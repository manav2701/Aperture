# Aperture architecture (as built, Phases 0–12)

Aperture is one control plane for how an organization's **people and AI agents spend money on AI**. Every rail enters through it: AI provider APIs, image and video generation, fiat cards, x402 stablecoin payments, and seats. Each spend is checked against budgets, policies and mandates, then approved, refused, or queued for a person, and charged to the right budget in one USD ledger with a hash-chained audit trail.

Snapshot of 2026-10-08. The design reasoning is in [plan/architecture](../plan/architecture/README.md) and the ADRs in [docs/adr](adr/README.md). This page shows what the code does today.

**Diagrams:**

1. [System context](#1-system-context)
2. [Services and deployment](#2-services-and-deployment)
3. [Monorepo: apps and packages](#3-monorepo-apps-and-packages)
4. [Money: four rails, one ledger](#4-money-four-rails-one-ledger)
5. [A governed gateway request](#5-a-governed-gateway-request)
6. [A card authorization](#6-a-card-authorization)
7. [An x402 payment on Solana](#7-an-x402-payment-on-solana)
8. [Authority: policies, approvals, mandates, audit](#8-authority-policies-approvals-mandates-audit)
9. [Visibility: posture, inventory, seats, attestations (Phases 11–12)](#9-visibility-posture-inventory-seats-attestations-phases-1112)
10. [Data model](#10-data-model)

Then: [background jobs](#background-jobs), [trust boundaries and secrets](#trust-boundaries-and-secrets), [invariants](#invariants).

---

## 1. System context

Who talks to Aperture, and what Aperture talks to.

```mermaid
flowchart LR
  subgraph people["People"]
    admin["Owners, admins, finance,<br/>team leads, auditors"]
    member["Members<br/>(workspace chat, My AI tools)"]
    dev["Developers<br/>(Claude Code)"]
    verifier["Anyone with an attestation<br/>(auditor, customer)"]
  end

  subgraph agents["Software"]
    agent["AI agents and apps<br/>(OpenAI/Anthropic SDKs,<br/>@aperture/sdk, MCP hosts)"]
  end

  subgraph aperture["Aperture"]
    web["Web<br/>dashboard and workspace"]
    api["API<br/>control plane"]
    gw["Gateway<br/>data plane"]
    worker["Worker<br/>scheduled jobs"]
    signer["Signer<br/>x402 keys, private"]
    db[("Postgres<br/>ledger, audit, everything")]
  end

  subgraph outside["Third parties"]
    llm["AI providers<br/>OpenRouter, OpenAI, Anthropic,<br/>Gemini, Hugging Face, fal, Runway"]
    seatsvc["Seat products<br/>Cursor, Claude, Copilot,<br/>Microsoft 365"]
    stripe["Customer's Stripe Issuing<br/>+ Aperture's Stripe Billing"]
    sol["Solana<br/>treasury, allowances,<br/>x402 sellers"]
    notify["Resend email, Slack"]
    mail["Inbound mail provider<br/>(receipts)"]
  end

  admin --> web
  member --> web
  verifier -->|"/verify, offline CLI"| web
  web --> api
  agent -->|"Aperture key or mandate"| gw
  dev -->|"OTLP metrics with a telemetry token"| gw
  dev -->|"plugin: MCP at /mcp"| gw
  api --> db
  gw --> db
  worker --> db
  gw --> signer
  api --> signer
  gw -->|"passthrough, the org's own keys"| llm
  worker -->|"usage and limits via admin APIs"| llm
  worker -->|"read-only seat APIs"| seatsvc
  stripe -->|"real-time authorization webhook"| api
  api -->|"issue task cards; Checkout"| stripe
  signer -->|"delegate-signed transfers"| sol
  worker -->|"watch settlements, anchor audit roots"| sol
  worker --> notify
  api --> notify
  mail -->|"signed raw RFC 822"| api
```

**Two planes.**

- The **gateway** decides every request in real time and must stay fast. It is fail-closed: if it can't decide, it refuses.
- The **API** is where people configure and review things, and where Stripe and the inbound mail provider call back in.
- Both share one Postgres. That's where every hold, capture, decision and audit event is written.

---

## 2. Services and deployment

Five deployable apps share one database. The only network path between them is the signer, which is private.

```mermaid
flowchart TB
  subgraph staging["Staging today"]
    direction LR
    v["Vercel<br/>apps/web"]
    r1["Render<br/>apps/api"]
    r2["Render<br/>apps/gateway"]
    r3["Render<br/>apps/worker"]
    neon[("Neon Postgres")]
    v --> r1
    r1 --> neon
    r2 --> neon
    r3 --> neon
  end

  subgraph prod["Production plan (Google Cloud, on hold until after Phase 16)"]
    direction LR
    cf["Cloudflare DNS"]
    crweb["Cloud Run: web<br/>scales to zero"]
    crapi["Cloud Run: api<br/>min 1"]
    crgw["Cloud Run: gateway<br/>min 1"]
    crsig["Cloud Run: signer<br/>internal ingress only"]
    vm["e2-micro VM: worker<br/>(always-free tier)"]
    sql[("Cloud SQL Postgres 17<br/>private IP, PITR")]
    gcs[("Cloud Storage<br/>generated media")]
    sm["Secret Manager<br/>per-service secrets"]
    cf --> crweb
    cf --> crapi
    cf --> crgw
    crapi --> sql
    crgw --> sql
    vm --> sql
    crgw --> crsig
    crapi --> crsig
    crgw --> gcs
    sm -.-> crapi
    sm -.-> crgw
    sm -.-> crsig
  end
```

| App            | Does                                                                                                                                                                                                                                                                                     | Talks to                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/web`     | Next.js App Router: dashboard, workspace chat and media, My AI tools, public `/verify` and shared attestations                                                                                                                                                                           | API only, through typed `openapi-fetch` clients generated from `docs/api/openapi.json` |
| `apps/api`     | Hono + zod-openapi control plane. It serves 140 operations: orgs, members, teams, budgets, policies, agents, keys, connections, approvals, mandates, cards, x402, posture, inventory, attestations, seats, receipts, billing. It also serves the Stripe, Slack and inbound-mail webhooks | Postgres, signer, Stripe, Resend, Slack                                                |
| `apps/gateway` | The data plane: OpenAI-, Anthropic- and Gemini-format passthrough, images and videos, `/v1/x402`, the agent's own `/v1/me`, `/v1/card` and `/v1/approvals`, MCP over HTTP at `/mcp`, and OTLP telemetry ingest at `/otlp/v1/*`                                                           | Postgres, providers, signer                                                            |
| `apps/worker`  | Runs the pg-boss-backed scheduler (see [jobs](#background-jobs)). The API can run the same jobs with `RUN_WORKER=true`                                                                                                                                                                   | Postgres, providers' admin APIs, seat APIs, Solana RPC, email and Slack                |
| `apps/signer`  | Holds the x402 delegate keys, encrypted under their own KEK. It signs only transfers that match an approved hold, and has no public URL                                                                                                                                                  | Postgres, Solana RPC                                                                   |

Self-hosting uses `infra/compose.selfhost.yml`: Caddy, two replicas each of the API and gateway, the worker, the signer on an internal network, and Postgres with WAL-G backups.

---

## 3. Monorepo: apps and packages

pnpm workspaces and Turborepo, all TypeScript. Logic sits in packages so the apps stay thin. `@aperture/core` is pure: it does no I/O and is property-tested.

```mermaid
flowchart BT
  core["@aperture/core<br/>money, periods, pricing, policy engine,<br/>mandates, posture catalogue, coverage,<br/>AI tool catalogue, statements, receipts,<br/>MIME, OTLP mapping, insights, RBAC"]
  crypto["@aperture/crypto<br/>canonical JSON, hash chain, Merkle,<br/>Ed25519 JWS, envelope encryption, API keys"]
  db["@aperture/db<br/>Drizzle schema (55 tables), 18 migrations,<br/>RLS, ledger, audit, posture snapshot,<br/>attestations, seats"]
  connectors["@aperture/connectors<br/>provider and seat connectors, prices"]
  cards["@aperture/cards<br/>Stripe Issuing auth, state machine, FX"]
  x402["@aperture/x402<br/>requirements, transactions, RPC"]
  media["@aperture/media<br/>image/video adapters, storage"]
  runtime["@aperture/runtime<br/>env, logging, health, shutdown, email"]
  jobs["@aperture/jobs<br/>every scheduled job, alerts"]
  sdk["@aperture/sdk<br/>agent client"]
  mcp["@aperture/mcp<br/>10 MCP tools"]
  connect["@aperture/connect<br/>Claude Code telemetry setup CLI"]

  api["apps/api"]
  gw["apps/gateway"]
  worker["apps/worker"]
  signer["apps/signer"]
  web["apps/web"]
  cli["tools/cli<br/>simulate, audit/mandate/attestation verify,<br/>admin, smoke, try-*"]
  plugin["integrations/claude-code-plugin"]

  crypto --> db
  core --> db
  core --> connectors
  core --> cards
  core --> x402
  core --> media
  db --> jobs
  connectors --> jobs
  cards --> jobs
  x402 --> jobs
  media --> jobs
  sdk --> mcp

  db --> api
  jobs --> api
  cards --> api
  runtime --> api
  db --> gw
  media --> gw
  x402 --> gw
  mcp --> gw
  runtime --> gw
  jobs --> worker
  runtime --> worker
  x402 --> signer
  db --> signer
  core --> web
  db --> cli
  sdk --> cli
  mcp -.->|"remote over HTTP"| plugin
```

Code checks: `pnpm check` runs format, lint, typecheck, unit, property, fuzz and integration tests on Testcontainers Postgres, knip, and a guard against imports from `legacy/`.

---

## 4. Money: four rails, one ledger

All money is integer **micro-USD** (1 µUSD = 1 USDC atomic unit). Every rail uses the same **authorize → capture** pattern:

1. Place a **hold** on every budget on the principal's path (agent → team → org), all or nothing.
2. **Capture** the actual cost, or **release** the hold.

```mermaid
flowchart LR
  subgraph rails["Rails"]
    g["Gateway<br/>text, images, video"]
    p["Provider usage<br/>imported by connectors"]
    c["Cards<br/>Stripe Issuing"]
    x["x402<br/>USDC on Solana"]
  end

  subgraph decide["Decision (same for every rail)"]
    pol["Policy engine<br/>org → team → principal layers<br/>+ mandate narrowing"]
    bud["Budget tree<br/>hard / soft, per period,<br/>org timezone"]
  end

  subgraph ledger["Ledger (append-only)"]
    hold["hold"]
    cap["capture / unheld_capture"]
    rel["release / expire"]
    obs["observed<br/>(after the fact, T1/T2)"]
    usage[("budget_usage<br/>spent + held per period")]
  end

  g --> pol
  c --> pol
  x --> pol
  pol --> bud
  bud --> hold
  hold --> cap
  hold --> rel
  p --> obs
  cap --> usage
  obs --> usage
  hold --> usage

  ext["external_spend, seats,<br/>receipts, telemetry"] -. "never touch the ledger<br/>(INV-16, INV-17)" .-> usage
```

**Enforcement tiers:**

| Tier                     | Where                                                       | What Aperture can do                                                                     |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Enforced**             | Gateway, managed cards, x402 allowances under a hard budget | Decide before the money moves                                                            |
| **T2 (provider limits)** | Keys Aperture created at OpenRouter, OpenAI and others      | Mirror the remaining budget as the provider-side key limit, and revoke it when exhausted |
| **T1 (visible)**         | Imported provider usage                                     | See it, alert on it, charge it after the fact                                            |
| **External**             | Statements, receipts, declarations, seats                   | Evidence only: shown in inventory, coverage and posture, never in budgets                |

---

## 5. A governed gateway request

An agent calls `POST /v1/chat/completions` with its Aperture key. Nothing reaches the provider until policy and budget say yes.

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent
  participant G as Gateway
  participant DB as Postgres
  participant P as Provider

  A->>G: request + Aperture key (or mandate token)
  G->>DB: key hash → principal, org, status, standing mandate (cached)
  alt key unknown, revoked, or agent paused (kill switch)
    G-->>A: 401 / 403, nothing forwarded
  end
  G->>G: estimate max cost from model price × capped max_tokens
  G->>G: evaluate policy layers (+ mandate): allow, deny, or approval_required
  alt denied
    G->>DB: log decision (gateway_requests, audit)
    G-->>A: 403 with the rule that refused
  else approval required
    G->>DB: open one approval (Slack / email / dashboard)
    G-->>A: 403 aperture_approval_required + approval_id
  end
  G->>DB: reserve: hold on every budget on the path (all or nothing)
  alt a budget can't cover it
    G-->>A: 402 aperture_budget_exceeded, naming the budget
  end
  G->>P: forward with the org's provider key, output capped (obligation)
  P-->>G: response or SSE stream (passed through byte for byte)
  G-->>A: stream
  G->>DB: settle: capture the exact cost from reported usage, release the rest
  Note over G,DB: Client disconnect mid-stream → settle what was used (G3).<br/>Upstream 429/5xx → release, nothing charged.
```

Images and videos follow the same pattern, but the hold stays open while a background poller (`media.poll`) waits for the job. The poller stores the result privately and settles the reported cost.

---

## 6. A card authorization

Stripe Issuing asks the customer's endpoint, live, whether to approve each card swipe. Aperture answers from the ledger within Stripe's time limit. A timeout counts as a decline.

```mermaid
sequenceDiagram
  autonumber
  participant M as Merchant
  participant S as Stripe Issuing (customer's account)
  participant API as Aperture API
  participant DB as Postgres
  participant H as Approver

  Note over H,API: Before: an agent asks for a single-use task card<br/>(SDK / MCP create_task_card) → a person approves → card issued, merchant-locked
  M->>S: card payment
  S->>API: issuing_authorization.request (signed webhook)
  API->>DB: card → principal, policy (merchant categories, caps), FX to USD
  API->>DB: hold on the budget path
  alt allowed and covered
    API-->>S: approve
  else
    API-->>S: decline (reason recorded)
  end
  S->>API: later events: captured, reversed, refunded…
  API->>DB: event state machine (INV-11): capture / release / refund
  Note over API,DB: Daily cards.reconcile. Any authorization Stripe approved<br/>without asking us shows as decision=unseen (posture check)
```

The card number never touches Aperture's servers (bring your own issuer, ADR 0017).

---

## 7. An x402 payment on Solana

An agent pays an HTTP 402 API in USDC from a company budget account. Aperture never holds the funds:

- The treasury gives each agent's budget account an on-chain **SPL delegate allowance**: a hard cap enforced by Solana itself.
- Aperture's **signer** co-signs only transfers that match an approved hold.

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent
  participant G as Gateway
  participant Sel as x402 seller
  participant DB as Postgres
  participant Sg as Signer (private)
  participant Sol as Solana

  A->>G: pay_x402(url)
  G->>Sel: request
  Sel-->>G: 402 + payment requirements (price, payTo, asset)
  G->>G: validate: asset is USDC/USDT, payee rule, depeg guard, price ≤ caps
  G->>DB: policy + hold on the budget path
  G->>Sg: sign transfer for this hold
  Sg->>DB: check hold matches (amount, payee, account)
  Sg-->>G: delegate-signed transaction
  G->>Sel: retry with X-PAYMENT
  Sel->>Sol: settle (seller or facilitator)
  Sel-->>G: response + settlement proof
  G-->>A: response
  G->>DB: capture, record delivery (or paid-but-undelivered, X5)
  Note over G,Sol: x402.watch confirms settlement on chain.<br/>x402.reconcile runs daily. Allowance ≤ remaining budget is a posture check
```

---

## 8. Authority: policies, approvals, mandates, audit

Who may spend what, who can say yes, and the record that proves it.

```mermaid
flowchart TB
  subgraph who["Identity"]
    users["Users<br/>Better Auth: password, magic link, Google;<br/>TOTP 2FA required for owner/admin/finance"]
    members["Members + roles<br/>owner, admin, finance, team_lead, member, auditor"]
    principals["Principals<br/>people and agents (+ sub-agents),<br/>purpose, data classes, risk tier"]
    keys["Gateway keys apk_…<br/>(hashed + pepper)"]
  end

  subgraph rules["Rules"]
    budgets["Budget tree<br/>org → team → principal, hard/soft"]
    policies["Policies (versioned)<br/>allow/deny models, per-action cap,<br/>approval threshold, merchant categories,<br/>x402 payees, prompt logging…"]
    mandates["Mandates<br/>Ed25519 JWS from the org key (JWKS);<br/>delegation can only narrow"]
  end

  subgraph yes["Human in the loop"]
    approvals["Approvals<br/>dashboard, email, Slack app"]
  end

  subgraph proof["Record"]
    audit["Audit chain<br/>each event hashes the previous (RFC 8785 JSON)"]
    anchors["Daily Merkle root anchored on Solana<br/>(audit.anchor)"]
    export["JSONL export<br/>pnpm audit-verify"]
  end

  users --> members --> principals
  principals --> keys
  principals --> budgets
  policies --> principals
  mandates --> principals
  principals -->|"over a threshold"| approvals
  approvals -->|"decision"| audit
  budgets --> audit
  policies --> audit
  mandates --> audit
  audit --> anchors
  audit --> export
```

**Row-level security.**

- Every org table has an RLS policy that keys on `app.org_id`.
- The services connect as a non-superuser role (`aperture_app`).
- `withOrg(db, orgId, fn)` sets the org for the transaction, and `withSystem` is used only by jobs.
- So a bug in one route can't read another org's rows. Tests check this for every table.

---

## 9. Visibility: posture, inventory, seats, attestations (Phases 11–12)

The visibility layer reads what the enforcement layer recorded, and adds evidence about AI that never touches an Aperture key. Nothing in this layer moves money or writes to the ledger.

```mermaid
flowchart LR
  subgraph sources["Sources"]
    led[("Ledger, holds,<br/>gateway_requests")]
    cfg[("Budgets, policies, keys,<br/>members, 2FA, cards, x402,<br/>mandates, audit chain")]
    stmt["Bank / card statement CSV<br/>parsed in the browser,<br/>only AI rows sent"]
    rcpt["Receipts<br/>inbound email (HMAC) or .eml upload"]
    seatapi["Seat connectors (read-only)<br/>Cursor, Claude, Claude Code,<br/>Copilot, M365 + CSV import"]
    otlp["Claude Code OTLP metrics<br/>(telemetry token, http/json,<br/>prompt attributes dropped)"]
    decl["My AI tools<br/>self-declarations"]
  end

  subgraph store["Stored evidence (no ledger writes)"]
    ext[("external_spend")]
    seats[("seats,<br/>seat_usage_daily")]
    receipts[("receipts<br/>fields + message hash only")]
    tud[("tool_usage_daily")]
  end

  subgraph compute["Computed"]
    snap["collectPostureSnapshot<br/>(no secret columns)"]
    eval["evaluatePosture<br/>catalogue v1: 37 checks,<br/>waivers, score A–F"]
    cov["Coverage<br/>enforced / visible /<br/>unassigned / external = 100%"]
    inv["Inventory<br/>everything that can spend"]
    ins["Seat insights<br/>idle, paid twice, consolidate,<br/>seat vs API, unapproved"]
    card["Agent cards"]
  end

  subgraph out["Outputs"]
    ui["Posture, Inventory, Shadow AI,<br/>Seats, AI tools pages"]
    alerts["Alerts: new critical/high failure,<br/>waiver expiring, seat overage"]
    att["Signed attestation<br/>JSON (JWS) + PDF,<br/>share links"]
    ver["/verify in the browser,<br/>pnpm attestation-verify"]
  end

  stmt --> ext
  rcpt -->|"one-off"| ext
  rcpt -->|"subscription"| seats
  seatapi --> seats
  decl --> seats
  otlp --> tud
  led --> cov
  ext --> cov
  seats --> cov
  cfg --> snap
  led --> snap
  seats --> snap
  tud --> snap
  snap --> eval
  cfg --> inv
  led --> inv
  seats --> inv
  seats --> ins
  tud --> ins
  cfg --> card
  led --> card
  eval --> ui
  cov --> ui
  inv --> ui
  ins --> ui
  eval --> alerts
  eval --> att
  cov --> att
  led --> att
  cfg -->|"audit range + Merkle root"| att
  att --> ver
```

**Attestation trust.**

- On Aperture Cloud, the platform key (Ed25519, envelope-encrypted) signs attestations and agent cards. A self-hosted install signs with its own instance key and says so.
- Every key, current and retired, is published at `/.well-known/aperture/jwks.json`, so old attestations keep verifying after a rotation.
- Verifiers check the JWS `typ` and the payload `type`, so an agent card can't pass as an attestation.

---

## 10. Data model

The main tables and how they relate. There are 55 tables in all; the ones below carry the domain. Every table except the global ones (`users`, `platform_signing_keys`, `fx_rates`, `model_prices`) has an `org_id` with RLS.

```mermaid
erDiagram
  orgs ||--o{ members : has
  users ||--o{ members : "is"
  orgs ||--o{ teams : has
  orgs ||--o{ principals : has
  teams ||--o{ principals : groups
  principals ||--o{ api_keys : holds
  principals ||--o{ mandates : "acts under"
  orgs ||--o{ budgets : has
  budgets ||--o{ budgets : "parent of"
  budgets ||--o{ budget_usage : "per period"
  orgs ||--o{ policies : "versioned"
  principals ||--o{ ledger_entries : "charged to"
  ledger_entries }o--|| holds : "settles"
  orgs ||--o{ connections : has
  connections ||--o{ credentials : "provider keys"
  credentials }o--o| principals : "assigned to"
  principals ||--o{ gateway_requests : makes
  principals ||--o{ approvals : asks
  principals ||--o{ cards : "task cards"
  cards ||--o{ card_authorizations : has
  principals ||--o{ x402_accounts : "budget account"
  orgs ||--o{ audit_events : "hash chain"
  orgs ||--o{ audit_anchors : "daily roots"
  orgs ||--o{ posture_runs : has
  orgs ||--o{ posture_waivers : has
  orgs ||--o{ external_spend : evidence
  orgs ||--o{ attestations : signs
  attestations ||--o{ attestation_shares : "share links"
  orgs ||--o{ seats : has
  seats ||--o{ seat_usage_daily : activity
  connections ||--o{ seats : "seat connector"
  seats ||--o{ receipts : "evidence"
  users ||--o{ telemetry_tokens : owns
  users ||--o{ tool_usage_daily : reports
  orgs ||--|| org_settings : has
  orgs ||--o| org_billing : has
```

---

## Background jobs

One scheduler (`packages/jobs`) runs them in the worker. pg-boss locking makes each job run once even with several workers.

| Job                                       | Every             | Does                                                                      |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `connector.sync`                          | 1 min             | Import provider usage, mirror T2 limits, revoke exhausted keys            |
| `alerts.scan`, `alerts.dispatch`          | 1 min, 30 s       | Budget thresholds; send queued alerts (email, Slack)                      |
| `holds.expire`                            | 30 s              | Release or settle expired holds                                           |
| `media.poll`                              | 10 s              | Finish image and video jobs, store privately, settle                      |
| `approvals.notify`, `approvals.expire`    | 15 s, 5 min       | Notify approvers; expire stale requests                                   |
| `prices.sync`, `prices.stable`, `fx.sync` | daily, 5 min, 6 h | Model prices, stablecoin prices (depeg guard), FX rates                   |
| `cards.expire`, `cards.reconcile`         | 10 min, daily     | Close expired task cards; reconcile with Stripe                           |
| `x402.watch`, `x402.reconcile`            | 20 s, daily       | Confirm settlements on chain; reconcile                                   |
| `audit.anchor`                            | hourly            | Anchor each day's audit Merkle root on Solana                             |
| `ledger.verify`                           | daily             | Ledger totals equal budget usage (drift check)                            |
| `privacy.retention`, `privacy.deletions`  | daily, hourly     | Retention; org deletion after the grace period                            |
| `posture.run`                             | daily             | Posture per org; alert on new critical/high failures and expiring waivers |
| `seats.sync`                              | 6 h               | Read seats and activity from seat connectors                              |
| `seats.idle`                              | daily             | Mark seats idle or active from the org's threshold                        |
| `seats.overage`                           | daily             | Alert when seat overage passes the org's threshold                        |

---

## Trust boundaries and secrets

```mermaid
flowchart LR
  subgraph public["Public internet"]
    browser["Browser"]
    agentk["Agent with apk_ key"]
    devt["Developer with apt_tel_ token"]
    hooks["Stripe, Slack, mail provider"]
  end
  subgraph edge["Public services"]
    web2["web"]
    api2["api<br/>session cookie + CSRF same-origin,<br/>RBAC + RLS, signed webhooks"]
    gw2["gateway<br/>key hash lookup, fail-closed,<br/>per-key/org limits"]
  end
  subgraph private["Private network"]
    sig2["signer<br/>shared secret, own KEK,<br/>signs only matching holds"]
    db2[("Postgres<br/>app role without superuser, RLS")]
  end
  browser --> web2 --> api2
  hooks -->|"HMAC / Stripe signature"| api2
  agentk --> gw2
  devt -->|"telemetry only, can't call models"| gw2
  api2 --> db2
  gw2 --> db2
  api2 --> sig2
  gw2 --> sig2
  sig2 --> db2
```

| Secret                                                                                                              | Protected by                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Provider connection secrets, provider keys Aperture created, org mandate-signing keys, the platform attestation key | Envelope encryption under `APERTURE_KEK_V<n>`. Rotate with `admin rotate-kek`, which re-wraps every one of them |
| x402 delegate keys                                                                                                  | A separate `SIGNER_KEK_V<n>`, present only in the signer                                                        |
| Gateway keys (`apk_`), telemetry tokens (`apt_tel_`), share-link tokens                                             | Stored only as a peppered hash; shown once                                                                      |
| Card numbers                                                                                                        | Never on Aperture's servers (customer's issuer)                                                                 |
| Prompts                                                                                                             | Not logged by default; telemetry prompt attributes are dropped at ingest                                        |

## Invariants

The ones the tests enforce:

- **INV-1–4** (Phase 2, property-tested with real concurrency): a hard budget is never exceeded; counters equal a fold of the journal; holds reach one terminal state; repeated operations are idempotent.
- **INV-7, INV-8, INV-10:** policy monotonicity, scope intersection, and fail-closed evaluation (`evaluate(anything)` never allows and never throws).
- **INV-12:** the signer produces a signature only when every x402 check passes, and every transaction it signs passes the x402 Path 1 verifier rules.
- **INV-14:** replaying overlapping connector windows gives an identical ledger.
- **INV-15:** any edit to the audit chain is detected.
- **INV-11:** the card event state machine accepts events in any order, and they're idempotent.
- **INV-13:** a denied request never sends a byte upstream (fuzzed).
- **INV-16:** statements and external spend never touch `ledger_entries`, `holds` or `budget_usage`.
- **INV-17:** seats, receipts and telemetry never touch them either.
- **Fail closed:** every rail refuses when it can't decide (ADR 0010).
