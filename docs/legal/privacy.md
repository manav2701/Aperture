# Privacy Policy — DRAFT

> **Draft for legal review** (UAE PDPL, and the GDPR for EU data subjects). Bracketed items are decisions to make.

**Controller for account data:** [ENTITY], [ADDRESS], [CONTACT EMAIL].
For data the Customer puts into Aperture (its members, agents, spend records), the **Customer is the controller** and Aperture is its processor. See the DPA.

## What we collect

- **Account data:** name, email, password hash, two-factor secrets (encrypted), sign-in records (IP address, user agent, times).
- **Organization data:** members and roles, teams, budgets, policies, agents, API key metadata (never the keys themselves), connection metadata. Provider secrets are stored encrypted and never shown again.
- **Usage and spend records:** the gateway requests (model, token counts, cost, outcome), card authorizations (merchant, amount; **never card numbers**), crypto payments (addresses, amounts, transaction signatures), approvals and the audit log.
- **Prompts and generated media:** prompt content is not logged by default. Generated images and videos are stored privately for the retention period the org sets.
- **Billing:** handled by Stripe. We keep the Stripe customer id and the subscription status.

## Why

To provide the service; to secure it (fraud and abuse prevention, rate limits, audit); to bill; and to meet legal obligations. The legal bases are the contract with the Customer, legitimate interests (security) and legal obligation.

## How long

Account data is kept while the account exists. Request logs and media are kept for the retention the org sets (defaults: 90 days). The ledger and audit log are kept for [PERIOD] after termination (evidence and legal hold).

## Sharing

With sub-processors only, as listed in [subprocessors.md](subprocessors.md). With connected third parties only as the Customer directs. We don't sell personal data.

## Transfers

[Where hosting and processing happen, and the safeguards for transfers outside the UAE/EEA.]

## Your rights

Access, correction, deletion, portability (org export), objection and restriction, subject to the law. Contact [CONTACT EMAIL]. You may complain to the UAE Data Office or your local supervisory authority.

## Security

Encryption in transit (TLS) and at rest; envelope encryption for secrets; tenant isolation enforced in the database; two-factor authentication for privileged roles; an append-only, hash-chained audit log. See docs/security.
