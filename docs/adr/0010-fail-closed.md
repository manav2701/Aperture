# 0010 — Fail closed by default

- Status: Accepted (2026-09-24)

## Context

When Aperture can't reach its database or evaluate a policy, it must choose between blocking spend (an availability cost) and allowing it (a governance failure).

## Decision

Fail closed everywhere money moves: the gateway returns 503, card authorizations fall back to the issuer's timeout setting configured as "decline", the signer refuses to sign, and the policy engine returns deny on internal errors. Orgs may opt into `open_capped` for the gateway only, which allows a small per-key cap while the database is unavailable and reconciles later.

## Consequences

- An Aperture outage blocks the customer's AI usage, so availability of Postgres and the gateway matters (Phase 10 hardening).
- Customers must set their card program's timeout behaviour; the connection health check verifies it.
