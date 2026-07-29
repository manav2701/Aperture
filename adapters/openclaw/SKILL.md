---
name: aperture-guardrails
description: Corporate treasury spending limits & on-chain Token-2022 policy guardrails for OpenClaw agents.
version: 0.1.0
author: Aperture Finance
license: MIT
triggers:
  - spend
  - pay
  - buy
  - purchase
  - x402
  - check budget
  - spending limit
  - pause agent
---

# Aperture OpenClaw Skill (ClawHub)

This skill integrates **Aperture v3** corporate treasury guardrails into **OpenClaw** AI agents.

## Functionality
1. **Pre-Call Interception**: Intercepts paid API calls (x402) *before* the HTTP request fires and validates daily/per-tx limits against Solana Token-2022 Policy PDAs on-chain.
2. **Heartbeat Scheduler**: Daily spending resets, threshold notifications (e.g. 80% cap reached), and automated spend summary reports.
3. **Escalation Triggers**: Escalates large transactions to human approvers via Slack/Telegram webhooks.

## Usage
When making a paid API request:
```typescript
import { ApertureOpenClawSkill } from "./src/index";

const guard = new ApertureOpenClawSkill();
const check = await guard.validatePreflight("7fCo...nVPi", 10.0, "https://api.provider.com/data");
if (check.approved) {
  // Proceed with x402 payment
}
```
