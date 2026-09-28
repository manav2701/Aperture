# Getting started with Aperture

Aperture puts budgets, policies and approvals in front of everything your people and AI agents spend: AI models, company cards, and pay-per-request APIs in crypto. Every decision lands in an audit log you can verify yourself.

## 1. Create your organization

Sign up and create an organization. Owners, admins and finance must turn on **two-factor authentication** (Account → Security) before they can change anything.

## 2. Connect an AI provider

**Connections → Connect.** Aperture needs an admin or management key at the provider, so it can see all usage and create keys for your agents:

| Provider      | Key to create                                    | What Aperture can do                                           |
| ------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| OpenRouter    | Management key                                   | Import spend, create keys with limits that mirror your budgets |
| OpenAI        | Admin key (org owner)                            | Import spend, create keys, revoke on breach                    |
| Anthropic     | Admin key (organization account)                 | Import spend, deactivate keys on breach                        |
| Google Gemini | API key (plus a service account for enforcement) | Gateway access; spend visibility with the service account      |

## 3. Budgets and policies

- **Budgets:** org → team → person or agent, per day, week or month, hard or soft. A child can't outspend its parent.
- **Policies:** allowed models and providers, per-request caps, time windows, merchant categories and countries for cards, payees for crypto, and "approval above X". Use **Simulate** before publishing.

## 4. Agents and the gateway

Create an agent with its own budget, then issue it a key (shown once). Point any OpenAI-compatible SDK at the gateway:

```ts
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.APERTURE_KEY, baseURL: 'https://gw.<your-domain>/v1' });
await openai.chat.completions.create({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] });
```

The Anthropic SDK uses base URL `https://gw.<your-domain>/anthropic`; Gemini uses `…/google/v1beta/models/<model>:generateContent`.

Refusals come back in each SDK's own error shape: `aperture_budget_exceeded`, `aperture_policy_denied`, `aperture_approval_required` (with an `approval_id`). Retry an approved request with the header `x-aperture-approval: <id>`.

## 5. Approvals and mandates

- **Approvals** wait on the Approvals page, in email, or in Slack (install the app under Settings → Alerts). Nobody can approve their own request, or one from an agent they own.
- **Mandates** are signed, scoped permissions for an agent: models, budget, uses and expiry. An agent can pass a smaller slice to a sub-agent. Revoking a mandate cuts off every sub-agent under it. Anyone can verify a mandate offline with `pnpm mandate-verify` against your org's public keys.

## 6. SDK and MCP

- `@aperture/sdk`: budget, estimates, approvals (`waitForApproval`), sub-agents, task cards, `x402Fetch`, and pausing an agent.
- `@aperture/mcp`: the same as tools for Claude, Cursor and other MCP hosts (stdio, or `POST https://gw.<your-domain>/mcp`).

## 7. Cards (Stripe Issuing)

**Cards → connect** your Stripe Issuing restricted key, then set the two webhook URLs shown there in Stripe, with the authorization timeout set to **decline**.

- Issue virtual cards to agents. Aperture decides every purchase in real time.
- Purchases over your approval threshold become approvals; approving one issues a **single-use card** for that amount.

## 8. Crypto payments (x402 on Solana)

**Crypto → connect** your treasury wallet's address (never its key). For each agent, create a budget account: your wallet signs a transaction that funds it and grants the agent an allowance, which is the most it can ever spend. Agents then pay x402 APIs with `x402Fetch` or the `pay_x402` MCP tool. A site that switches its payout address waits for Finance.

## 9. Audit

**Audit log:** every change and every decision, hash-chained. Export it and verify it offline:

```bash
pnpm audit-verify export.jsonl                         # the chain is intact
pnpm audit-verify day.jsonl --check-anchor <signature>  # and matches the root written on Solana
```

## 10. Privacy and billing

- **Settings → Privacy:** retention for request logs and media, export everything, delete the organization (30-day grace period).
- **Settings → Billing:** plans, invoices and payment method.
