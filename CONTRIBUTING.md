# Contributing

The full conventions are in [plan/conventions](plan/conventions/README.md). This page is the short version.

## Setup

```bash
pnpm install
pnpm dev
```

Node.js 24+ and pnpm 11. pnpm refuses package versions younger than 3 days (`minimumReleaseAge`) and runs dependency install scripts only for packages listed under `allowBuilds` in `pnpm-workspace.yaml`. Add to that list only after checking why the package needs a script.

## Workflow

1. Branch from `main`: `phase-<n>/<short-topic>`, e.g. `phase-2/ledger-reserve`.
2. Keep pull requests small and focused; fill in the PR template.
3. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat(gateway): …`, `fix(ledger): …`, `docs(plan): …`, `chore(ci): …`.
4. `pnpm check` must pass locally; CI must be green before merge.
5. Record significant decisions as an ADR in [docs/adr/](docs/adr/).

## Rules that CI enforces

- TypeScript strict mode, no `any`, type-only imports marked as such.
- No `console.*` (use the logger from `@aperture/runtime`), no `Math.random`, no browser `alert/confirm/prompt`, no `dangerouslySetInnerHTML`, no empty `catch`.
- No unused files, exports, or dependencies (knip).
- Nothing outside `legacy/` imports from `legacy/`.
- No secrets in the repository (Gitleaks); no Stripe card-number expansion and no `fetch` of request-controlled URLs (custom Semgrep rules).

## Tests

- Tests sit next to the code (`*.test.ts`) and run with Vitest.
- Anything with an invariant (money, budgets, policy) gets property-based tests with fast-check, starting in Phase 2.
- Every bug fix starts with a failing test.
