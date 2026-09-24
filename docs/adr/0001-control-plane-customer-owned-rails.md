# 0001 — Control plane on customer-owned rails

- Status: Accepted (2026-09-24)

## Context

Governing AI spend could mean holding the money (a wallet, a card program, reselling model tokens) or governing money the customer already holds. Holding money brings money-transmission, card-program, and virtual-asset custody obligations, plus working-capital risk, which a bootstrapped company can't carry.

## Decision

Aperture owns identity, policy, budgets, approvals, mandates, and audit. Money stays on rails the customer owns: their AI provider accounts (bring your own keys), their card program (Stripe Issuing, NymCard), and their Solana accounts. Aperture enforces through each rail's control points and through its own gateway.

## Consequences

- No customer funds or card numbers on our side; a far smaller regulatory surface.
- Enforcement strength varies by rail (tiers T0–T3, plan/architecture §12); the UI must show it honestly.
- Onboarding needs admin credentials from each provider; connectors must tolerate partial capabilities.
