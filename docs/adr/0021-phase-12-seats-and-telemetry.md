# 0021 — Seats, receipts and terminal-tool telemetry (Phase 12)

**Status:** Accepted. Built and tested locally; connectors are tested against fakes built from vendor docs.
**Date:** 2026-10-08

## Decisions

1. **Seats are visible, never enforced.**
   - `seats` holds one row per person per tool, with `source` (connector, import, receipt, statement, declared, manual), `payer`, cost and status.
   - `seat_usage_daily` holds the activity and overage a connector reports.
   - **INV-17:** seat, receipt and telemetry imports never touch `ledger_entries`, `holds` or `budget_usage`. A test enforces it, as for INV-16.
   - In coverage, seats from an admin API count as `visible`; receipts, statements and declarations count as `external`.
2. **One seat per source key** (`connection:<id>:<user>`, `receipt:<user>:<tool>`, …).
   - Re-syncs and re-imports are idempotent.
   - A team-plan receipt for a seat a connector already reports attaches to that seat as evidence, and fills only a missing cost (S2). A personal plan bought next to a company seat stays separate, and the "paid twice" insight flags it.
3. **Read-only seat connectors** are built only where the docs could be confirmed: Cursor Admin API, Claude Enterprise Analytics, Claude Code Analytics (Admin API), GitHub Copilot seats, and Microsoft 365 Copilot (Graph usage report).
   - ChatGPT Business/Enterprise and Gemini come in through a **seat CSV import** of their admin-console exports (D12-3).
   - Connector credentials reuse the encrypted `connections` table with `seat:` providers. A refused key marks the connection `broken` and alerts.
4. **Idle seats.** A connector or imported seat becomes `idle` when it has no activity for the org's `idle_seat_days` (default 30, set on **Seats → Settings** with the overage alert threshold), and `active` again on use.
   - This runs daily in `seats.idle` and after every sync, using the same rule as the `seats.idle` posture check.
   - Receipts and declarations carry no activity, so they're never called idle.
5. **Receipts inbox, minimised.**
   - Raw RFC 822 arrives at `POST /webhooks/inbound-email`, signed with HMAC-SHA-256 (`INBOUND_EMAIL_SECRET`), or as an `.eml` upload (D12-5).
   - Deterministic templates handle the top vendors. No LLM parses receipts.
   - A receipt is trusted when the sender is a verified member, or when our receiving server (`INBOUND_AUTHSERV_ID`) reports a DKIM pass for the vendor's domain (D12-4). Everything else goes to the review queue.
   - The body and attachments are discarded after extraction. Only the extracted fields and a SHA-256 of the message are kept, and the message hash deduplicates.
6. **Terminal telemetry over OTLP `http/json` only** (D12-1). Protobuf gets a clear 415.
   - Telemetry tokens (`apt_tel_…`) are hashed at rest, scoped to one member and one tool, revocable, rate-limited, and unable to call models or the API.
   - Logs and traces are accepted and dropped unread, so a misconfigured client doesn't retry forever.
   - Metric attributes outside an allow list are dropped at ingest. A test sends prompt text and checks that it isn't stored.
   - Cumulative points are refused: only delta is accepted, so retries and restarts can't double count.
   - Cost is shown as the **list-price equivalent**.
7. **Claude Code only, for now.** Codex and Gemini CLI are deferred until their metric names can be confirmed (D12-2).
   - `@aperture/connect` writes Claude Code's settings into the user's `~/.claude/settings.json` `env` block. A repository's settings can't turn telemetry on, by Claude Code's design.
   - It turns on metrics only, shows a masked diff, asks first, keeps a 0600 backup, and `--undo` removes exactly its keys.
8. **The Claude Code plugin** (`integrations/claude-code-plugin`) adds the gateway's `/mcp` endpoint as a remote MCP server with the agent key from `userConfig` (stored as sensitive), plus two skills (`budget-check`, `spend-approval`).
   - A plugin can't set telemetry environment variables, so telemetry stays with `@aperture/connect`.
   - Governed mode (Claude Code's own model calls through the gateway) is a managed-settings template in `docs/guides/claude-code.md`.
9. **Offboarding:** removing a member revokes their telemetry tokens. Their seats stay listed with the holder marked as departed, ready to reclaim (S1).
10. **Permissions:**
    - `seats.read` and `seats.manage`;
    - `receipts.review`;
    - `tools.declare`, which every role has, for their own tools;
    - `telemetry.manage`.

## Consequences

- To test them live:
  - The inbound address needs a domain and an MX record.
  - Each seat connector needs an admin key for a real workspace.

  Both are in `plan/your-checklist.md` §G.

- Not built yet:
  - an admin diagnostics view for unknown OTLP metric names (S7: they're ignored today);
  - an alert on abnormal telemetry volume (S5: rate limiting only);
  - the quarterly declaration reminder email (the `tools.declaration_fresh` check already measures freshness).
- 12.9 (moving a subscription onto a governed card) waits on Stripe Issuing access (D5).
