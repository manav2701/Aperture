# @aperture/mcp

Aperture's agent controls as Model Context Protocol tools. Any MCP host can use them: Claude Code, Claude Desktop, Cursor and others. The server has no authority of its own; every tool call runs with the agent's own key.

| Tool                  | Does                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `get_budget`          | What the agent may still spend, and the mandate it acts under                                       |
| `list_allowed_models` | Models allowed right now, with prices; flags the ones that need approval                            |
| `estimate_cost`       | The most a chat, image or video call could cost, and whether it would be allowed (spends nothing)   |
| `request_approval`    | Asks a person to allow a specific spend; returns an approval id                                     |
| `check_approval`      | Pending, approved (and for how much), denied, expired or used                                       |
| `create_subagent`     | A sub-agent with its own key and a smaller slice of this agent's mandate                            |
| `pause_self`          | Stops the agent now; only a person can resume it                                                    |
| `get_agent_card`      | Its agent card: declared purpose, data classes, risk tier, rules that apply, budget left, mandates  |
| `create_task_card`    | Asks for a single-use card for one purchase (a person approves; the number never passes Aperture)   |
| `pay_x402`            | Calls a URL and, if it asks for x402 payment, pays it in USDC within budget, policy and payee rules |

## Stdio (local hosts)

```json
{
  "mcpServers": {
    "aperture": {
      "command": "npx",
      "args": ["tsx", "path/to/Aperture/packages/mcp/src/stdio.ts"],
      "env": { "APERTURE_API_KEY": "apk_…", "APERTURE_BASE_URL": "https://api.example.com/gw" }
    }
  }
}
```

Claude Code: `claude mcp add aperture --env APERTURE_API_KEY=apk_… --env APERTURE_BASE_URL=https://…/gw -- npx tsx packages/mcp/src/stdio.ts`

## Streamable HTTP (remote hosts)

The gateway serves the same tools at `POST {gateway}/mcp`. Authenticate with `Authorization: Bearer apk_…`. It is stateless: each request uses the key it carries.

To embed it in your own server, use `handleMcpHttp(request, { baseUrl })`. It takes a web-standard `Request` and returns a `Response`.

## Limits

Agents can't use MCP to approve their own requests or change policy (P10). A sub-agent always gets less than its parent has.
