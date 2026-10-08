---
name: budget-check
description: Check the Aperture budget, agent card and allowed models before starting work that calls paid AI models, generates images or video, buys something, or pays an x402 API. Use when the user asks what you may spend, or before any paid step.
---

Before paid work, read what governs you in Aperture, then plan within it.

1. Call the `get_agent_card` tool from the `aperture` MCP server. Note the remaining budget, the rules that apply (for example `max_amount_per_action`, `approval_threshold`, `allow_models`), the declared data classes, and any active mandate with its expiry.
2. If you'll call a model, call `list_allowed_models` and pick an allowed one. A model with `needs_approval: true` needs a person first.
3. For each paid step, call `estimate_cost` with the request you plan to make. If it says `allowed: false`, don't make the call: change the plan (a cheaper model, fewer tokens) or use the `spend-approval` skill.
4. Tell the user, in one or two lines, what you expect to spend and what limits you're under.

Never try to get around a refusal, for example by splitting one purchase into several small ones to stay under a per-action cap. Aperture records every decision in its audit log.
