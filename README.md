# Aperture

**Governance for AI spend.** Aperture is a control plane where an organization decides who — a person or an AI agent — may spend how much, on what, and through which rail: AI provider APIs, cards from the customer's own card program, and stablecoin (x402) payments on Solana. Every decision goes into a tamper-evident audit log.

Aperture never holds customer money or card numbers: it enforces through the customer's own provider accounts, card program, and wallets.

## Status

Rebuilding from the original hackathon demo. **Phases 1 and 2 of 10 are complete**: the repository is a clean, tested TypeScript monorepo, and the core domain works end to end on a real database — money, budget periods, the policy engine, mandates, the budget ledger with holds, and the hash-chained audit log. There is no API or UI yet; that starts in Phase 3.

- The build plan, architecture, and research: [plan/](plan/README.md)
- What is being built, and for whom: [plan/vision](plan/vision/README.md)

## Repository map

| Path               | What it is                                                                                   | Status                   |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------ |
| `apps/web`         | Next.js dashboard and workspace                                                              | Placeholder landing page |
| `apps/api`         | Control-plane API (orgs, budgets, policies, approvals, audit, webhooks)                      | Health endpoints only    |
| `apps/gateway`     | Data plane: governed AI passthrough, media jobs, x402 authorization                          | Health endpoints only    |
| `apps/worker`      | Background jobs: connector sync, limit mirroring, settlement                                 | Health endpoints only    |
| `apps/signer`      | Internal Solana signing service (never public)                                               | Health endpoints only    |
| `packages/core`    | Money, periods, pricing, policy engine, mandates (pure)                                      | Done                     |
| `packages/crypto`  | Canonical JSON, audit hash chain, Merkle roots                                               | Done                     |
| `packages/db`      | Postgres schema and migrations, budget ledger, audit log                                     | Done                     |
| `packages/runtime` | Shared service bootstrap: env validation, redacting logger, health routes, graceful shutdown | Done                     |
| `packages/config`  | Shared TypeScript config                                                                     | Done                     |
| `tools/cli`        | Scenario simulator and offline audit verifier                                                | Done                     |
| `infra/`           | Local dev stack, service Dockerfile, Supabase lockdown script                                | —                        |
| `docs/adr/`        | Architecture decision records                                                                | —                        |
| `legacy/`          | Archived hackathon build (not built or deployed)                                             | Archived                 |
| `plan/`            | Build plan: phases 0–10 and reference docs                                                   | —                        |

The remaining packages (`connectors`, `auth`, `sdk`, `mcp`, `ui`) are created in the phase that implements them.

## Run it locally

Requirements: Node.js 24+, pnpm 11 (`npm install -g pnpm` or Corepack), and Docker.

```bash
pnpm install
pnpm dev                                        # web :3000, api :4000, gateway :4100, worker :4200, signer :4300
curl localhost:4000/healthz                     # {"status":"ok","service":"api"}
docker compose -f infra/compose.dev.yml up -d   # Postgres 17 + MinIO

# See budgets, policies, and the ledger at work (and verify the audit log offline):
pnpm try:simulate tools/cli/scenarios/two-teams.yaml --audit-out audit.jsonl
pnpm audit-verify audit.jsonl
```

The database tests use Testcontainers, so Docker must be running for `pnpm test`.

## Checks

`pnpm check` runs everything CI runs on the code: Prettier, ESLint, TypeScript, Vitest, knip (unused code and dependencies), and a guard that nothing imports from `legacy/`. CI additionally runs Gitleaks over the full history, Semgrep (registry rules plus the custom rules in `.semgrep/`), `pnpm audit`, and builds and smoke-tests each service image.

## Contributing and security

- How we write code: [CONTRIBUTING.md](CONTRIBUTING.md) and [plan/conventions](plan/conventions/README.md)
- Reporting a vulnerability: [SECURITY.md](SECURITY.md)
