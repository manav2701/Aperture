# Claude Code with Aperture

There are three ways to connect Claude Code, from lightest to strongest. Use one or combine them.

| Mode              | What Aperture sees                                                          | What it controls                                 | Works with a subscription login |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| **Visibility**    | Sessions, tokens, lines of code and list-price cost per developer (metrics) | Nothing; seats are visible, not enforced         | Yes                             |
| **Agent tools**   | What the agent asks for through the MCP tools                               | Paid steps the agent takes through Aperture      | Yes                             |
| **Governed mode** | Every model call, with cost, through the gateway                            | Budgets, policies, approvals, kill switch, audit | No: needs API billing           |

## Visibility: telemetry from each developer

1. In Aperture, open **My AI tools → Connect Claude Code** and create a telemetry token (`apt_tel_…`). It's shown once. It can only send usage metrics; it can't call models or the API.
2. On the developer's machine:
   ```bash
   npx @aperture/connect claude-code --token apt_tel_… --gateway https://gateway.<domain>
   ```
   It shows the change (token masked) and asks before writing. It only touches the telemetry keys in the `env` block of `~/.claude/settings.json`, keeps a backup, and `--undo` removes them.
3. Restart Claude Code. Usage shows in **Seats → Terminal tools** within a few minutes.

What it sets, if you'd rather do it by hand:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "none",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://gateway.<domain>/otlp",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer apt_tel_…",
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "delta"
  }
}
```

**Privacy:**

- Only metrics are sent, and logs are off. Prompt and tool-input logging (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`) stays off.
- Even if a client sends prompt text, the gateway drops every attribute outside an allow list before storing anything.
- Aperture only accepts `http/json` with delta temporality. Protobuf gets a 415, and cumulative points are refused rather than double counted.

## Visibility for the whole company: managed settings

To report every developer without asking each one, deploy the same `env` block as **managed settings**. Claude Code applies managed settings above every other level. The file locations are:

- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`
- Linux and WSL: `/etc/claude-code/managed-settings.json`
- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`

A shared token can't tell developers apart, so give each machine its own token: create one per developer and template it into the file with your MDM. A repository's own `.claude/settings.json` can't turn telemetry on or change where it goes, by Claude Code's design.

## Agent tools: the Aperture plugin

The plugin in `integrations/claude-code-plugin` adds Aperture's MCP tools under one **agent key**. The tools are `get_agent_card`, `get_budget`, `list_allowed_models`, `estimate_cost`, `request_approval`, `check_approval`, `pause_self`, and more. The plugin also adds two skills that tell Claude to check its budget before paid work and to ask a person when refused.

```bash
claude plugin marketplace add <this repository>/integrations
claude plugin install aperture-governance@aperture
```

Claude Code asks for the gateway URL and the agent key, and stores the key in the system credential store.

## Governed mode: Claude Code's own calls through the gateway

For teams on **API billing**, point Claude Code at the gateway so every developer has their own budget, policies and audit trail:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://gateway.<domain>/anthropic"
  },
  "apiKeyHelper": "/usr/local/bin/aperture-key"
}
```

- `apiKeyHelper` prints the developer's Aperture key (`apk_…`) for Claude Code to send as `x-api-key`. The helper can read it from the OS keychain, or fetch a short-lived one from your SSO.
- Create one agent per developer, with a hard budget, under **Agents**.
- In managed settings, `apiKeyHelper` is read from the managed source only, so developers can't swap in a different key.
- Also pin the default model (`"model"`) in managed settings to one your policy allows.

**Verify before rolling out:**

- The gateway serves `POST /anthropic/v1/messages` (streaming and non-streaming).
- Check on one machine that Claude Code's other calls work through it, for example token counting (`/v1/messages/count_tokens`), which the gateway doesn't serve yet.
- If they don't, keep that team on visibility mode until the gateway supports them.

## Codex and Gemini CLI

Not supported yet: their telemetry metric names couldn't be confirmed from their documentation. `@aperture/connect` says so rather than writing a config that might not work.
