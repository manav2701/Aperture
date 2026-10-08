# @aperture/connect

Sends a developer's terminal AI tool usage to Aperture, so **Seats → Terminal tools** shows sessions, tokens, lines of code and the list-price-equivalent cost per person, including people on a subscription login.

```sh
npx @aperture/connect claude-code --token apt_tel_… --gateway https://gateway.example.com
npx @aperture/connect claude-code --undo
```

Create the token on **My AI tools → Connect Claude Code**. The tool:

- writes only the telemetry keys into the `env` block of `~/.claude/settings.json` (a repository's `.claude/settings.json` can't turn telemetry on, by Claude Code's design)
- turns on **metrics only**: `OTEL_LOGS_EXPORTER=none`, and `OTEL_LOG_USER_PROMPTS` / `OTEL_LOG_TOOL_DETAILS` are set to `0` if present; the gateway drops prompt-carrying attributes anyway
- shows the change (token masked) and asks before writing; `--yes` skips the question
- keeps `settings.json.aperture-backup` (mode 600) and writes atomically
- `--undo` removes exactly the keys it added and nothing else

| Tool        | Status                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------- |
| Claude Code | Supported (OTLP `http/json`, delta temporality)                                             |
| Codex       | Deferred: metric names not yet confirmed from its docs (D12-2 in the Phase 11–12 checklist) |
| Gemini CLI  | Deferred, as Codex                                                                          |

Telemetry tokens can only send metrics. They can't call models or the API, and removing a member revokes theirs.
