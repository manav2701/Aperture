/*
 * `@aperture/connect` (plan/phases/phase-12 §12.6): writes the telemetry settings that send a
 * terminal AI tool's usage metrics to Aperture, and removes them again. Only metrics are
 * turned on; prompt and tool-input logging stay off, and logs aren't exported at all.
 *
 * Claude Code reads these from the `env` block of the user's ~/.claude/settings.json (a
 * repository's .claude/settings.json can't turn telemetry on or pick a destination, by design).
 * Codex and Gemini CLI are deferred (D12-2): their metric names couldn't be confirmed.
 */

export const TARGETS = ['claude-code'] as const;
export type Target = (typeof TARGETS)[number];

/** A telemetry token is `apt_tel_` and 24 random bytes in base64url; anything else is refused before writing. */
const TOKEN = /^apt_tel_[A-Za-z0-9_-]{32}$/;

/** Keys we own. `--undo` removes exactly these and nothing else. */
export const CLAUDE_CODE_KEYS = [
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE',
] as const;

/** Content-logging switches that must never be on while metrics go to Aperture. */
const CONTENT_LOGGING = ['OTEL_LOG_USER_PROMPTS', 'OTEL_LOG_TOOL_DETAILS'] as const;

export class ConnectError extends Error {}

/** The env entries for Claude Code; the same as the dashboard shows on My AI tools. */
export function claudeCodeEnv(input: { token: string; gatewayUrl: string }): Record<string, string> {
  if (!TOKEN.test(input.token))
    throw new ConnectError(
      'that is not an Aperture telemetry token (they start with apt_tel_); create one on My AI tools',
    );
  let url: URL;
  try {
    url = new URL(input.gatewayUrl);
  } catch {
    throw new ConnectError(`not a URL: ${input.gatewayUrl}`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new ConnectError('the gateway URL must use https (http only for localhost)');
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: `${url.origin}${url.pathname.replace(/\/+$/, '')}/otlp`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${input.token}`,
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
  };
}

type Settings = Record<string, unknown>;

/** Parses settings.json; an empty or missing file is `{}`. Refuses anything that isn't an object. */
export function parseSettings(text: string | undefined): Settings {
  if (text === undefined || text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConnectError('the settings file is not valid JSON; fix it by hand first, nothing was changed');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new ConnectError('the settings file is not a JSON object; nothing was changed');
  return parsed as Settings;
}

function envOf(settings: Settings): Record<string, unknown> {
  const env = settings.env;
  if (env === undefined) return {};
  if (typeof env !== 'object' || env === null || Array.isArray(env))
    throw new ConnectError('"env" in the settings file is not an object; nothing was changed');
  return env as Record<string, unknown>;
}

export interface Change {
  key: string;
  before: string | undefined;
  after: string | undefined;
}

export interface Plan {
  settings: Settings;
  changes: Change[];
}

const shown = (value: unknown) =>
  value === undefined ? undefined : typeof value === 'string' ? value : JSON.stringify(value);

/** The settings with our keys set (everything else kept), and what changes. */
export function connect(settings: Settings, env: Record<string, string>): Plan {
  const current = envOf(settings);
  const next: Record<string, unknown> = { ...current, ...env };
  // Prompt and tool-input logging off: we drop them at ingest anyway, but they shouldn't be sent.
  for (const key of CONTENT_LOGGING) if (key in next) next[key] = '0';
  const changes = Object.keys(next)
    .filter((key) => shown(current[key]) !== shown(next[key]))
    .map((key) => ({ key, before: shown(current[key]), after: shown(next[key]) }));
  return { settings: { ...settings, env: next }, changes };
}

/** The settings without our keys. Other settings and env entries are untouched. */
export function disconnect(settings: Settings): Plan {
  const current = envOf(settings);
  const next = Object.fromEntries(
    Object.entries(current).filter(([key]) => !(CLAUDE_CODE_KEYS as readonly string[]).includes(key)),
  );
  const changes = CLAUDE_CODE_KEYS.filter((key) => key in current).map((key) => ({
    key,
    before: shown(current[key]),
    after: undefined,
  }));
  const { env: _removed, ...rest } = settings;
  return { settings: Object.keys(next).length === 0 ? rest : { ...settings, env: next }, changes };
}

/** A diff for people: the token is masked so it doesn't end up in a terminal scrollback or a screenshot. */
export function describe(changes: readonly Change[]): string {
  const mask = (value: string | undefined) => value?.replace(/apt_tel_[A-Za-z0-9_-]+/g, (t) => `${t.slice(0, 12)}…`);
  if (changes.length === 0) return '  (nothing to change)';
  return changes
    .map(({ key, before, after }) =>
      after === undefined
        ? `  - ${key}=${mask(before) ?? ''}`
        : before === undefined
          ? `  + ${key}=${mask(after) ?? ''}`
          : `  ~ ${key}: ${mask(before) ?? ''} → ${mask(after) ?? ''}`,
    )
    .join('\n');
}
