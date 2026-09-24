# 0011 — Phase 1 tooling choices

- Status: Accepted (2026-09-24)

## Context

Setting up the monorepo surfaced choices that earlier ADRs don't cover.

## Decisions

1. **TypeScript 6.0, not 7.0.** TypeScript 7 (the native compiler) is released, but typescript-eslint 8.70 supports only `<6.1`. TypeScript is pinned to `~6.0`, and Renovate holds it below 6.1 until typescript-eslint supports 7.
2. **pnpm 11** (the current release). Supply-chain settings live in `pnpm-workspace.yaml`: a `minimumReleaseAge` of 3 days and an explicit `allowBuilds` list (only `esbuild` today).
3. **Services are bundled with esbuild into one `dist/index.cjs`.** Workspace packages are consumed as TypeScript source; bundling makes the runtime image just Node plus one file. tsup's `package.json` configuration didn't bundle workspace packages, and plain esbuild needs no config file.
4. **No git hooks.** lefthook's Windows binary failed to start on the development machine, and a failing `prepare` script would break `pnpm install`. CI enforces formatting and lint instead; `pnpm check` gives the same result locally.
5. **Packages are created in the phase that fills them.** Phase 1 creates only `@aperture/config` and `@aperture/runtime` (the shared service bootstrap). Empty placeholder packages would be dead code.
6. **Scanners are pinned.** Semgrep and Gitleaks run in CI from version-pinned container images; GitHub Actions are pinned to commit SHAs.

## Consequences

- Upgrading to TypeScript 7 is a deliberate step, taken once the linter supports it.
- Contributors get no pre-commit feedback, but `pnpm check` reproduces CI locally.
