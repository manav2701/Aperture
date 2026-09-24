# 0005 — Policy engine as typed JSON rules

- Status: Accepted (2026-09-24)

## Context

Policies must be editable through forms, simulated, audited, and evaluated deterministically in a few milliseconds. Cedar is a strong general-purpose policy language, but it adds a WASM dependency and a learning curve before we know which rules customers need.

## Decision

Policies are Zod-validated JSON documents made of typed rules: allow/deny providers and models, per-action caps, approval thresholds, time windows, merchant categories and countries, x402 payees, token and media limits, prompt logging. Evaluation is a pure, total function: every scope must allow (intersection), any deny wins, then approval thresholds, then allow. Budgets are checked by the ledger, not by the policy engine.

## Consequences

- Easy to fuzz and property-test (monotonicity, intersection, attenuation).
- Revisit Cedar if customers need to author arbitrary policies, or if the rule set outgrows what forms can express.
