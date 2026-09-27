# @aperture/sdk

A small, dependency-free TypeScript client for agents that spend through Aperture.

Model calls go through the gateway with whatever SDK you already use (OpenAI, Anthropic or Gemini), pointed at the gateway URL. This package covers what those SDKs can't do:

- check the budget;
- price a call before making it;
- ask a person for approval and wait for the answer;
- delegate to sub-agents;
- stop the agent;
- read Aperture's refusals as typed errors.

## Set up

```ts
import { Aperture } from '@aperture/sdk';

const aperture = new Aperture({
  apiKey: process.env.APERTURE_API_KEY, // the agent's apk_… key
  baseUrl: process.env.APERTURE_BASE_URL, // e.g. https://api.example.com/gw
});
```

## What it does

```ts
await aperture.me(); // { budget: { remaining_usd }, mandate: { scope, uses, jws, … } }
await aperture.models(); // allowed models with prices; needs_approval marks the gated ones
await aperture.estimate({ type: 'chat', model: 'openai/gpt-4o', maxTokens: 2000 }); // spends nothing
```

### Approvals

```ts
import { ApprovalRequiredError, BudgetExceededError } from '@aperture/sdk';

const body = { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'Summarise Q3' }] };
try {
  await aperture.chat(body, { purpose: 'Q3 board summary' });
} catch (error) {
  if (error instanceof ApprovalRequiredError) {
    const decision = await aperture.waitForApproval(error.approvalId); // polls; 15 min default
    if (decision.status === 'approved') await aperture.chat(body, { approvalId: decision.id });
  } else if (error instanceof BudgetExceededError) {
    console.log(`only $${error.remainingUsd} left`);
  } else throw error;
}
```

Retrying through another SDK works too: send the header `x-aperture-approval: <id>`. An approval is good for exactly one call, up to the approved amount.

### Sub-agents

```ts
const helper = await aperture.createSubagent({
  name: 'summariser',
  purpose: 'Summarise each PDF',
  budgetUsd: '0.20',
  models: ['openai/gpt-4o-mini'],
  expiresInSeconds: 2 * 60 * 60,
});
// helper.api_key is shown once; give it to the sub-agent.
```

The sub-agent's mandate must fit inside yours. If you ask for more budget, other models, or a longer lifetime than you have, the call fails with a `PolicyDeniedError` that lists what was exceeded. Its spend also counts against your budget.

### Stop

```ts
await aperture.pauseSelf(); // every later paid call is refused until a person resumes the agent
```

## Errors

| Class                                  | When                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ApprovalRequiredError` (`approvalId`) | A policy wants a person to approve this call                                                 |
| `BudgetExceededError` (`remainingUsd`) | The budget can't cover the worst-case cost, or no budget applies                             |
| `PolicyDeniedError`                    | A policy or mandate forbids it (model, provider, per-call cap, a used-up or revoked mandate) |
| `PrincipalInactiveError`               | The agent is paused or revoked                                                               |
| `ApertureError`                        | Anything else; see `.type` and `.status`                                                     |

## Changelog

- **0.1.0**: first release: budget, models, estimates, approvals, sub-agents, pause, typed errors.
