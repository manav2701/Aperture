# Aperture plugin for Claude Code

Gives Claude Code Aperture's agent tools over MCP, under one Aperture **agent key**: `get_agent_card`, `get_budget`, `list_allowed_models`, `estimate_cost`, `request_approval`, `check_approval`, `create_subagent`, `create_task_card`, `pay_x402` and `pause_self`. The server is the gateway's `/mcp` endpoint, and every call runs with that agent's budget, policies and mandate.

Two skills tell Claude when to use them: **budget-check** (read the limits before paid work) and **spend-approval** (ask a person, then wait).

## Install

```sh
claude plugin marketplace add <path or git URL of this repository>/integrations
claude plugin install aperture-governance@aperture
```

Claude Code asks for the gateway URL and the agent key when the plugin is enabled. The key is stored in the system's secure credential store, not in `settings.json`.

## What the plugin does not do

- **Telemetry.** A plugin can't set Claude Code's telemetry environment, so usage reporting for a developer's own seat is set up with `npx @aperture/connect claude-code` (see `docs/guides/claude-code.md`).
- **Route Claude's own model calls.** Pointing Claude Code itself at the Aperture gateway (governed mode) is done with managed settings; see the same guide.

Check the plugin with `claude plugin validate integrations/claude-code-plugin` and the marketplace with `claude plugin validate integrations`.
