# 0007 — Bring-your-own card issuer; never handle card numbers

- Status: Accepted (2026-09-24)

## Context

Stripe Issuing offers real-time authorization (a 2-second webhook), the fiat equivalent of the old transfer hook, but it isn't available to UAE entities. Running a card program ourselves would bring program-manager obligations, and card numbers in our systems would put us in PCI DSS cardholder-data scope.

## Decision

The customer (or a partner fintech) owns the card program (Stripe Issuing, NymCard). Aperture receives a restricted key, answers real-time authorization requests from the ledger, and manages cards and their controls via the API. Aperture never requests or stores full card numbers or CVCs; a Semgrep rule enforces this.

## Consequences

- Stripe's spending controls act as a backstop; Aperture's ledger is authoritative.
- Processors without real-time decisioning (possibly NymCard) get "limit mirroring", with a bounded worst-case overspend.
- Agents that need card details fetch them from the issuer with the customer's own credentials.
