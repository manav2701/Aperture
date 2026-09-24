## What and why

<!-- What changes, and the reason. Link the plan phase/task, e.g. plan/phases/phase-02-core-domain task 2.5. -->

## How to test

<!-- Commands to run and what you should see. For UI changes, add screenshots. -->

## Definition of done

- [ ] No mocks or fake data in production code paths
- [ ] Unit tests; property tests if there is an invariant; integration test if it touches the DB or an external API
- [ ] `pnpm check` passes (format, lint, typecheck, tests, knip, legacy-import guard)
- [ ] Errors mapped to stable codes; logs structured, no secrets
- [ ] Audit events for decisions and configuration changes (from Phase 2 on)
- [ ] Docs updated (package/app README, plan if the design changed, ADR for decisions)
- [ ] The phase's security checklist reviewed
