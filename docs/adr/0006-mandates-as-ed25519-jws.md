# 0006 — Mandates as Ed25519 JWS with attenuation

- Status: Accepted (2026-09-24)

## Context

Agents act on behalf of people and delegate to sub-agents. Research on agent authorization (plan/research) converges on delegation that is scoped, narrows at each hop, is time-bound, and is auditable. Google's AP2 uses signed mandates as verifiable credentials.

## Decision

A mandate is a scoped grant (rails, providers, models, payees, per-action cap, budget, validity window, maximum uses, purpose) stored in the database and signed as a compact JWS with a per-org Ed25519 key. A child mandate must be a subset of its parent; this is checked on creation and enforced on every action. Revocation cascades to descendants, and use counts increment inside the reserve transaction.

## Consequences

- Mandates can be exported and verified by third parties using the org's public JWKS.
- Model patterns are limited to exact names or a trailing `*`, so subset checks stay decidable.
- Exporting mandates as W3C Verifiable Credentials (AP2 compatibility) is a later addition, not a rewrite.
