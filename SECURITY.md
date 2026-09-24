# Security

Aperture decides whether money moves, so we treat security reports as the highest priority.

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** on this repository ([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)). Please include the affected component, steps to reproduce, and the impact you expect. Do not open a public issue.

You will get an acknowledgement within 72 hours and an assessment within 7 days. Please give us a reasonable time to fix the issue before disclosing it.

## Scope

- Everything under `apps/`, `packages/`, and `infra/`.
- The archived code under `legacy/` is not deployed and is out of scope, but tell us if you find a live deployment of it.

## How we handle security

The threat model and controls are in [plan/security](plan/security/README.md).
