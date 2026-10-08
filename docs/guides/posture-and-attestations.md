# Posture, inventory and attestations

Three questions a CISO or compliance lead asks: **what AI is in use and who owns it**, **is our setup safe**, and **can we prove it to someone else**. Aperture answers each from data it already holds. You don't need a new account or key.

## Posture

**Posture** runs 37 checks (catalogue v1) against your Aperture setup every day and on demand (**Run now**, at most once a minute). Each check is one of:

- `pass`;
- `fail`, listing the agents, keys, cards or connections at fault, with a fix link;
- `unknown`: the data is missing or stale, for example a connection that hasn't synced. It counts as a failure;
- `not applicable`: a rail you don't use. It's left out of the score.

The score weighs critical 10, high 5, medium 2 and low 1, and maps to a grade (A–F). A new critical or high failure sends an alert through your alert channels. A failure that was already there doesn't send another.

**Waive** a failure you accept:

- It needs a reason and an expiry of at most 180 days.
- It stays listed as `waived`, scores as passed, and alerts you 7 days before it expires.
- Every waiver is in the audit log.
- Only owners and admins can waive.

## Inventory and coverage

**Inventory** lists everything that can spend: agents, people, gateway keys, provider keys, connections, models, cards, x402 accounts, mandates and seats. Each row shows its owner, team, 30-day spend and **governance status**:

| Status       | Meaning                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `enforced`   | Decided before it happens: the gateway, a managed card, or an x402 allowance under a hard budget  |
| `visible`    | Imported after the fact: provider usage, seats from an admin API                                  |
| `unassigned` | Provider usage from keys nobody owns yet                                                          |
| `external`   | Found on a statement, a receipt, or declared by a member: AI spend Aperture doesn't see or govern |

The coverage bar shows the 30-day share of each status, and the shares always add up to 100%. **Export CSV** escapes spreadsheet formulas.

## Shadow AI

- **Unassigned keys:** provider keys created outside Aperture. Click **Claim** to assign one to a person or agent. New usage goes to them from then on; usage already imported stays where it was booked, and the audit event records both.
- **Statements:** upload a CSV export from your bank or card provider. **It's parsed in your browser.** Only rows that match an AI vendor (date, amount, currency, descriptor) are sent to Aperture, and your other transactions never leave your machine. Check the column mapping, then upload.
  - Rows in other currencies are converted at that day's rate, and the original amount is kept.
  - A row for a provider you already connect (for example the OpenAI invoice paid by card) is tagged `provider_billing` and not counted as shadow AI.
  - For each row: assign it to a person or team, **bring under governance** (connect the provider, issue a card, invite the person), or dismiss it with a reason.
- None of this touches budgets or the ledger (INV-16): it's evidence, labelled "external".

## Attestations

**Attestations → New** for a month, a quarter or custom dates (in your org's timezone, ending no later than today) builds a signed record with:

- your posture at the end of the period, and the worst result for each check during it;
- spend per rail, allowed and denied requests, approvals, mandates, kill-switch uses, and active waivers;
- the coverage figure;
- an **audit proof**: the range of audit events, the hashes before and after it, and their Merkle root. If the chain was broken, it says where;
- agents by name and risk tier. It holds no email addresses.

Download it as **JSON** (the record of truth, signed) or **PDF** (a rendering). To give an auditor access, create a **share link**:

- it expires within 90 days and can be revoked;
- opening it is rate-limited and audited.

> This attestation records what Aperture observed and enforced. It is not a certification, audit opinion, or statement of regulatory compliance.

### Verify one

Anyone can verify an attestation without trusting Aperture:

- **In a browser:** open `/verify` and drop in the JSON. The signature is checked in the page against the published keys, and the file isn't uploaded. Drop in the period's audit export (**Audit log → Export**) too, and the page recomputes the range and Merkle root.
- **Offline:**
  ```bash
  pnpm attestation-verify att.json --jwks jwks.json --audit audit.jsonl
  ```
  Save `jwks.json` from `/.well-known/aperture/jwks.json` to verify with no network. The command also checks that the readable `document` matches what was signed.

Keys are rotated yearly, and retired keys stay published, so old attestations keep verifying.

## Agent cards

Every agent has a card (**Agents → the agent**) with:

- who owns it and what it's for;
- budgets on its path, the rules that apply to it, mandates and sub-agents;
- its keys, cards and x402 accounts, each with a revoke button;
- 30-day activity and the posture checks about it.

Owners and admins can set its **declared purpose**, **data classes** and **risk tier**:

- A `high` agent must sit under a hard budget and an approval threshold (check `agents.high_risk_hard_capped`).
- **Download signed card** exports the card as a JWS for a registry or a vendor questionnaire.
- The agent reads its own card through `GET /v1/card`, the SDK's `card()`, or the MCP tool `get_agent_card`.
