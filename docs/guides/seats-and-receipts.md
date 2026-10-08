# Seats, receipts and AI tools

Most AI use goes through seats, not API keys: ChatGPT and Claude workspaces, Cursor, GitHub Copilot, Microsoft 365 Copilot, and personal plans people expense. Aperture can see these but can't meter or block single messages inside them. Seats are **visible**, never **enforced**, and they never touch your budgets or ledger (INV-17).

## Connect a product (read-only)

Go to **Seats → Connected products → Connect a product**, then paste an admin key:

| Product                  | Key                                                    | What comes in                                  |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------- |
| Cursor (Teams)           | Admin API key                                          | Members, daily activity, spend and overage     |
| Claude Team / Enterprise | Analytics API key                                      | Members and daily activity                     |
| Claude Code (API orgs)   | Admin API key                                          | Per-developer sessions, tokens, estimated cost |
| GitHub Copilot           | Token with Copilot billing read access, plus the org   | Seats and last activity                        |
| Microsoft 365 Copilot    | App registration (tenant, client id, secret) for Graph | Usage report per user                          |

Keys are read-only and encrypted like every other connection. People are matched to members by work email. A sync runs every 6 hours.

For **ChatGPT Business/Enterprise, Gemini, or anything else**, export the member list from the admin console and use **Import from an admin console** (CSV). Map the email, plan and last-active columns.

## Idle seats and insights

A connector or imported seat with no activity for 30 days is marked **idle** (change the number on **Seats → Settings**). **Insights** show the estimated monthly saving and what to do:

- **Idle seat:** reclaim it in the vendor's admin console.
- **Paid twice:** someone expenses a personal plan next to a company seat for the same tool.
- **Consolidate:** three or more people expense one vendor's personal plan; compare it with a team plan.
- **Seat vs API:** telemetry shows usage far below what the seat costs (API billing is cheaper) or far above it (keep the seat).
- **Not approved:** a tool that's not on your approved list.

Savings are estimates from list prices unless you set the real cost on the seat. Overage charges (usage on top of a seat) can alert above a threshold you set on **Seats → Settings**. Aperture can't cap them, so set limits in each vendor's console.

## Receipts inbox

Every org has an address `receipts-<token>@<inbound domain>`. It's shown on **My AI tools**. Members forward AI receipts to it, or set a mail rule; they can also upload a saved `.eml` file.

- Receipts from known vendors become a **seat** (subscriptions) or **external spend** (one-off purchases), converted to USD at that day's rate.
- A receipt is trusted when it comes from a verified member's own address, or when our mail server reports a DKIM pass for the vendor's domain. Everything else goes to **Seats → Receipts to review**. There, an admin fills in what didn't parse and imports or dismisses it.
- If a connector already reports the person's seat, a team-plan receipt attaches to that seat instead of adding a second one.
- **Minimisation:**
  - the email body and attachments are discarded after the fields are read;
  - Aperture keeps the vendor, plan, amount, currency, dates, sender domain and a hash of the message, which it uses to drop duplicates;
  - it never stores the sender's address.

## My AI tools

Every member has **My AI tools**. A new member lands on it after accepting an invitation ("Connect your AI tools"). There they can:

- **declare the tools they use**, the plan, and who pays (company card, expensed, or personal). It takes about 20 seconds. Declaring a tool that's not approved is fine: it shows as an insight, not a penalty;
- **confirm the list** when asked. Freshness shows in posture (`tools.declaration_fresh`);
- **forward receipts** to the address shown;
- **connect Claude Code** with a telemetry token (see [claude-code.md](claude-code.md)).

Admins keep the **approved tools** list on **AI tools**.

## When someone leaves

Removing a member revokes their telemetry tokens at once. Their seats stay listed with the holder marked **left**, so you can reclaim them in the vendor's console.
