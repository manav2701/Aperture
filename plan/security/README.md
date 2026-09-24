# Security

Aperture is a governance product: a security failure is a product failure. This document is the threat model and the control list. Each phase has a security checklist that points back here.

## Assets

| Asset | Why it matters |
|---|---|
| Customer provider credentials (OpenRouter management key, OpenAI/Anthropic admin keys, provider API keys) | Unlimited spend at the provider; data access |
| Card program credentials (Stripe restricted key, NymCard API credentials) | Card creation, limit changes |
| Solana delegate keys | Can move up to the allowance from each agent budget account |
| Aperture keys (agent credentials) | Spend within a budget |
| Ledger, policies, budgets | Integrity of every decision |
| Audit log | Evidence; must be tamper-evident |
| Prompts and generated media (if logging is enabled) | Confidential business data, personal data |
| Org signing key (mandates) | Forged mandates |

## Actors

External attacker; malicious or compromised agent (prompt injection); malicious insider at the customer (tries to approve own spend, hide spend); compromised third party (provider, facilitator, seller, npm/PyPI package); Aperture operator mistake.

## Trust boundaries

1. Browser ↔ `apps/api` (session cookies).
2. Agents ↔ `apps/gateway` (Aperture keys).
3. Third parties → webhooks (signatures).
4. `apps/*` ↔ Postgres (DB roles).
5. `apps/gateway` → `apps/signer` (internal network only).
6. Aperture → customer rails (credentials we hold).

## Threats and controls

| Threat | Control | Phase |
|---|---|---|
| Direct database access from the browser (current S1) | No browser DB access at all; API only; Postgres not exposed publicly | 1, 3 |
| Cross-tenant data access | Every query scoped by `org_id` in repositories; **Postgres RLS** as defence in depth (`SET app.org_id` per transaction, policies on every tenant table); automated tests that try cross-org access on every route | 3 |
| Broken authorization (member does admin things) | Central `authorize(actor, action, resource)` used by every route; route table test asserts each route declares a permission | 3 |
| Agent abuses control plane (prompt injection "raise my budget") | Agent keys accepted only by data-plane routes; control-plane router rejects them | 3, 5 |
| SSRF via gateway or x402 | Gateway upstream URLs come from a fixed provider allowlist, never from input; the x402 flow never fetches seller URLs server-side (the agent does) | 1, 5, 9 |
| Stolen Aperture key | Keys hashed (HMAC + pepper); shown once; instant revoke; budgets bound damage; optional IP allowlist per key | 5 |
| Stolen provider/admin credentials from our DB | Envelope encryption (AES-256-GCM, per-connection data key, KEK outside DB); decrypt only in the process that needs it; never returned by the API | 3, 4 |
| Webhook forgery / replay | Stripe `constructEvent` on the raw body; Slack signing secret with 5-minute timestamp tolerance; NymCard verification (**VERIFY** scheme; IP allowlist if no signature); `webhook_receipts` for replay | 7, 8 |
| Signer abuse | Separate service and KEK, internal network, signs only for an existing open hold whose intent matches exactly; rate limit per agent; on-chain allowance caps the blast radius | 9 |
| Tampered audit log | Hash chain + insert-only DB role + trigger; daily roots; optional on-chain anchoring; offline verifier | 2, 9 |
| Insider approves own spend | Separation of duties enforced server-side; approvals audited | 7 |
| PCI scope creep | Never request or store full card numbers; no `expand=number` anywhere (lint rule + code search in CI) | 8 |
| Supply-chain compromise | pnpm 10 (`minimumReleaseAge` e.g. 3 days, install scripts off except allowlisted), lockfile committed and reviewed, Renovate grouped updates, GitHub Actions pinned to commit SHAs, scanners pinned by digest, CI tokens least-privilege, no production secrets in CI | 1 |
| Secret leakage in logs | pino redaction paths; tests assert redaction; Sentry scrubbing | 1, 3 |
| XSS / CSRF in the dashboard | React escaping, strict CSP (no inline scripts except Next's nonce), `SameSite=Lax` cookies, CSRF protection from Better Auth, no `dangerouslySetInnerHTML` (lint) | 3 |
| Brute force / credential stuffing | Rate limits on auth routes; optional 2FA (Better Auth plugin) required for owner/admin/finance | 3 |
| Denial of service | Body size limits, per-org and per-key concurrency limits, Cloudflare in front of web/api | 5, 10 |
| x402 seller/facilitator attacks (USENIX 2026 study) | Payee binding, per-call caps, own settlement verification, per-seller delivery stats | 9 |
| Data exposure of prompts | Prompt logging off by default; per-org retention; encryption at rest (disk) | 5 |

## Immediate actions on the current system (Phase 1, day 1)

1. In the Supabase dashboard: check RLS on every table; enable RLS with no policies (deny all) on every table; rotate the publishable/anon and service-role keys.
2. Export demo data, then delete `policies.agent_mnemonic` values and drop the column. Move any real funds out of wallets whose mnemonic was stored.
3. Remove `OPENROUTER_API_KEY` from the running gateway deployment (or shut it down) and rotate the key at OpenRouter.
4. Take down or redeploy the web app without `app/api/proxy`.
5. Remove hardcoded Supabase fallbacks from source.

## Key management summary

| Key | Where | Rotation |
|---|---|---|
| `APERTURE_KEK_v{n}` | Environment of api/worker/gateway (from an encrypted secrets file on day one; cloud KMS later) | Yearly or on suspicion; re-wrap data keys |
| `SIGNER_KEK_v{n}` | Environment of `apps/signer` only | Same |
| `APERTURE_KEY_PEPPER` | Environment of gateway/api | Rotation = re-issue keys (rare) |
| Org mandate signing keys (Ed25519) | DB, envelope-encrypted | On demand; old public keys kept for verification |
| Better Auth secret | Environment of web/api | Yearly; invalidates sessions |
| Notary wallet (audit anchoring) | Signer | Low value; top up small amounts |

KEK backups: two offline copies (password manager + printed/sealed), recovery tested in Phase 10.

## Regulatory notes

(Not legal advice. Phase 0 includes getting a professional opinion.)

- **Money transmission / stored value**: avoided by design — Aperture never receives or holds customer funds (BYO keys, BYO issuer, customer-owned Solana accounts).
- **Card programs**: the customer (or a partner fintech) is the program owner with Stripe/NymCard; Aperture is software that answers authorization requests and calls their API.
- **PCI DSS**: stay out of cardholder-data scope by never touching PANs; still complete the relevant SAQ if a customer asks.
- **VARA (Dubai)**: custody is judged by practical control over keys/assets. A capped, revocable SPL delegate held by Aperture might still count. Options: legal opinion; customer-hosted signer (self-hosted `apps/signer`); licensed wallet partner. Phase 9 production release is gated on this.
- **Data protection**: UAE PDPL, DIFC/ADGM data protection laws for customers there; GDPR for EU customers. Default to metadata-only logging, data processing agreement template, and an in-country/self-hosted deployment option (see [deployment](../deployment/README.md#data-residency-and-self-hosting)).
- **EU AI Act**: deployers of high-risk systems must keep logs; Aperture's audit log helps customers meet record-keeping duties — a selling point, not an obligation on us as a tool vendor (**VERIFY** with counsel if targeting EU).

## Incident response (lightweight)

1. Detect (alerts, customer report). 2. Contain: global kill switch per org (pause all principals, stop signer, revoke provider keys on request). 3. Rotate affected secrets. 4. Assess via audit log. 5. Notify affected customers within 72 hours. 6. Write a post-mortem in `docs/runbooks/incidents/`.
