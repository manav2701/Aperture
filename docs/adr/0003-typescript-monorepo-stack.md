# 0003 — TypeScript monorepo and stack

- Status: Accepted (2026-09-24)

## Context

A solo founder needs one language across web, services, SDK, and MCP server, few moving parts, and a stack any contractor can pick up.

## Decision

pnpm workspaces + Turborepo; Next.js (App Router) for the web app; Hono on Node.js 24 for services; PostgreSQL 17 with Drizzle ORM; pg-boss for jobs (no Redis); Better Auth; Zod at every boundary; pino and OpenTelemetry; Vitest, fast-check, Testcontainers, Playwright, k6.

## Consequences

- One toolchain and one set of lint and type rules.
- Postgres carries the ledger, jobs, and audit log, so it is the component to back up and monitor most carefully.
