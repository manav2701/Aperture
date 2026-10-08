# Phase 14 — Finance layer: cost centres, chargeback, forecasts, exports

**Goal:** give the finance team the reports they close the month with. Every AI dollar, on every rail and every seat, lands on a cost centre and a project. Each department gets a statement, there's a forecast before the month ends, and the totals go into the accounting system without retyping.

**Duration:** ~2 weeks.
**Depends on:** Phases 4–9 (spend on every rail), Phase 12 (seats), Phase 13 (savings report). It works with whatever rails the org uses.
**Needs from you:** the design partner's chart of accounts or cost-centre list, and an accountant's view on VAT treatment (see 14.5).

## Why this phase

The buyer who signs is usually finance. Finout and the FinOps tools sell showback and chargeback; LiteLLM sells "bill teams for what they use". Only Aperture can put API calls, card purchases, x402 payments, and seats in **one** statement per department, because only Aperture holds all four.

## Starting point

- The ledger in integer micro-USD, with captures per principal, budget, and rail.
- Teams and principals; `fx_rates`; CSV export with formula-injection escaping (Phase 11).
- `seats` and `external_spend` (Phases 11–12), the savings report (Phase 13).
- Org timezone and budget periods (`packages/core/src/period.ts`).

## Scope

**In:** cost centres and projects; request-level tags; tag snapshots on ledger entries; monthly close with locked statements; budget vs. actual and forecasts; display currency; accounting CSV exports; unit-cost views.

**Out:** pushing to accounting APIs (Phase 15); invoicing customers of our customers; full FP&A.

## Tasks

### 14.1 Cost centres, projects, and tags

- New tables: `cost_centers` (`org_id`, `code`, `name`, `owner_user_id`, `gl_account`, `active`) and `projects` (same shape, plus optional `end_date`).
- Defaults: a team, principal, key, card, x402 account, or seat can carry a default cost centre and project. The most specific wins (key → principal → team).
- **Request tags:** clients may send `X-Aperture-Tags: project=q4-launch,customer=acme`. Only keys the admin allowed are accepted (max 5 per request, values ≤ 64 chars); others are dropped and counted.
- **Snapshot on capture:** each ledger capture stores the cost centre, project, and allowed tags as they were at that moment. Moving an agent to another team later doesn't rewrite history (**INV-18**).
- Re-tagging past spend is possible only as an audited **reclassification entry** in an open period, never by editing the original.

### 14.2 Monthly close and statements

- A job closes each period in the org's timezone (with a configurable grace of N days for late usage imports and card captures).
- **Statement per cost centre:** API spend by provider and model, card spend by merchant, x402 by payee, seats by tool, external spend, savings (Phase 13), and the totals. PDF and CSV.
- After close, the period is **locked**: later items (a late card capture, a provider adjustment) go into the next period as labelled adjustments.
- Statements are hash-referenced in the audit log, so a statement can be proven unchanged.

### 14.3 Budget vs. actual and forecasts

- Per cost centre, team, and agent: budget, actual to date, and a forecast to period end (run rate weighted toward recent days, plus the weekday pattern; no ML).
- **Forecast alert:** "Marketing will exceed its AI budget around 22 October at the current rate". It goes through the existing alert channels and can trigger Phase 13 soft landing early.
- A dashboard **Finance** page: one row per cost centre with budget, actual, forecast, variance, and drill-down to the entries.

### 14.4 Display currency and FX

- Org setting `display_currency` (for example AED). The ledger stays in micro-USD; reports convert at the daily `fx_rates` rate and say which rate was used. Card spend in its original currency is shown next to the converted amount.

### 14.5 Accounting exports (CSV)

- Export formats for **Xero**, **QuickBooks Online**, and **Zoho Books** (common in the UAE): one journal line per cost centre × GL account × vendor, with the period, description, and tax code column. **VERIFY** each product's import template.
- **VAT:** UAE businesses usually account for VAT on imported digital services under the reverse charge. Provide a per-vendor tax-code mapping that finance fills in once; **we don't decide tax treatment**. **VERIFY** with an accountant before calling the export "ready to post".
- A generic CSV with every field, for anything else.

### 14.6 Unit costs

- With tags, show cost per project, per customer tag, and per agent task (from mandates and approvals: total spend under a mandate). Exportable for pricing and margin work.

### 14.7 Permissions

`finance.read` (owner, admin, finance, auditor; team leads see their own cost centres), `finance.close` and `finance.reclassify` (owner, finance), `cost_centers.manage` (owner, admin, finance).

## Edge cases

- **F1** A late provider usage import for a closed period → booked as an adjustment in the open period, referencing the original period.
- **F2** A card capture in a different month from its authorization → it belongs to the capture date; the statement shows the authorization date too.
- **F3** An entity with no cost centre → goes to an `unallocated` line, which is a posture check (`finance.unallocated_share` under 5%).
- **F4** A cost centre is deactivated mid-period → existing snapshots keep it; new spend falls back to the next default.
- **F5** Rounding: conversion to display currency happens per line and the totals are sums of rounded lines, with a stated rounding difference, never silent drift.

## Tests

- **U:** default resolution order; tag filtering; forecast arithmetic on fixed series; export line grouping; rounding.
- **P:** the sum of all cost-centre statements equals total ledger captures plus seats plus external for the period (nothing lost, nothing counted twice); a reclassification moves money between cost centres without changing the total.
- **I:** INV-18: moving a principal to another team doesn't change past snapshots; a closed period can't be edited; a late import lands in the open period.
- **E:** close a month on seeded data → download statements and a Xero CSV → import the CSV into a Xero demo company (**VERIFY**).

## Security checklist

- [ ] Finance pages respect team scoping (RLS); a team lead sees only their cost centres
- [ ] Exports escape formula prefixes and are audited
- [ ] Request tags are allow-listed and length-limited (no free-form data dumping into the ledger)

## Deployment

Migrations for `cost_centers`, `projects`, `period_closes`, `statements`, `reclassifications`, and the snapshot columns on ledger captures (backfilled from current defaults, marked as backfilled). Jobs `finance.close` and `finance.forecast` (daily).

## Try it yourself

1. Create two cost centres, assign two agents and one seat → spend on each shows up on the right statement.
2. Send a request with `X-Aperture-Tags: project=demo` → it appears under that project.
3. Close last month → download the PDF statements and the Zoho Books CSV.
4. Watch the forecast warn when a team's run rate would break its budget.

## Exit criteria

- [ ] Cost centres, projects, tags, and snapshots live; INV-18 enforced by test
- [ ] Monthly close with locked statements across all rails and seats
- [ ] Forecasts with alerts; display currency
- [ ] Xero, QuickBooks, and Zoho Books CSV exports checked against each product's import (or marked VERIFY)
- [ ] ADR 0023 written; the design partner's finance contact has reviewed one month's statements
