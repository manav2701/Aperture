# @aperture/cli

Developer tools.

## Simulator

Runs a YAML scenario — org, budget tree, policies, and steps (spends, limit changes, the kill switch) — through the real policy engine and ledger on a throwaway database, and prints every decision.

```bash
docker compose -f infra/compose.dev.yml up -d postgres
pnpm try:simulate tools/cli/scenarios/two-teams.yaml --audit-out audit.jsonl
```

`DATABASE_URL` defaults to the dev compose Postgres. Each run creates a fresh database and drops it afterwards (`--keep` to inspect it). The scenario format is defined and validated in `src/scenario.ts`; `scenarios/two-teams.yaml` is a worked example.

## Audit verifier

Checks an exported audit log (JSON lines) offline, without trusting Aperture or its database.

```bash
pnpm audit-verify audit.jsonl        # exit 0: valid, prints the Merkle root; exit 1: first broken seq
```
