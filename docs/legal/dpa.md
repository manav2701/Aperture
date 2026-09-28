# Data Processing Agreement — DRAFT

> **Draft for legal review.** Based on GDPR Article 28 and UAE PDPL processor obligations. Attach it to the Terms. Bracketed items are decisions to make.

**Parties:** the Customer (controller) and [ENTITY] (processor).

1. **Subject matter and duration.** Processing the Customer's personal data to provide Aperture, for the term of the agreement and the retention periods in section 8.
2. **Nature and purpose.** Hosting, storing and processing member, agent and spend records to enforce the Customer's budgets and policies, and to provide audit and reporting.
3. **Categories of data subjects.** The Customer's members (employees and contractors) and people named in approvals or audit records.
4. **Categories of personal data.** Names, emails, roles, sign-in metadata, IP addresses, and actions recorded in the audit log. No special-category data is intended. Card numbers are never processed.
5. **Processor obligations.**
   - Process only on documented instructions.
   - Keep personnel under confidentiality.
   - Apply the security measures in Annex A.
   - Assist with data subject requests and DPIAs.
   - Notify personal data breaches without undue delay, and within [48] hours.
   - Delete or return data at the end of the service (section 8).
   - Make information available for audits.
6. **Sub-processors.**
   - General authorization for those in [subprocessors.md](subprocessors.md).
   - [30] days' notice of changes, with a right to object.
   - Flow-down obligations to each sub-processor.
7. **International transfers.** [Mechanism: SCCs / adequacy / UAE PDPL cross-border rules.]
8. **Deletion.**
   - The Customer can export and delete data from the product.
   - On deletion, operational data is erased after a 30-day grace period.
   - The spend ledger and audit log are retained for [PERIOD] as agreed evidence, and then erased.
   - Backups age out within 30 days.

## Annex A — Security measures

- TLS 1.2+ everywhere; HSTS.
- Tenant isolation with Postgres row-level security on every tenant table, tested automatically.
- Secrets encrypted with AES-256-GCM envelope encryption; keys held outside the database and rotated at least yearly.
- Two-factor authentication required for owners, admins and finance; rate limits on authentication.
- An append-only, hash-chained audit log, with optional public anchoring.
- Encrypted, continuous backups with 30-day point-in-time recovery, tested monthly by restore drills.
- Least-privilege access for staff; changes reviewed through pull requests; dependency and secret scanning in CI.
