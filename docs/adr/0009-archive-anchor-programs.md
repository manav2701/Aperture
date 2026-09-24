# 0009 — Archive the Anchor programs

- Status: Accepted (2026-09-24)

## Context

The hackathon's `policy-manager`, `session-tracker`, and `org-registry` programs govern only mints created with the transfer hook, double-count daily spend, and leave several policy fields unsettable (plan/current-state). Their build relied on a patched `anchor-syn` and pinned-down dependencies.

## Decision

Move all hackathon code under `legacy/`, tag the pre-archive state `legacy-v0`, and exclude it from builds, lint, and CI. Nothing outside `legacy/` may import from it (enforced by a CI guard).

## Consequences

- History and ideas are preserved; the new code starts clean.
- If on-chain enforcement is needed later, it builds on Swig or Squads rather than reviving these programs.
