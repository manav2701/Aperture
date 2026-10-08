import fc from 'fast-check';
import { describe as group, expect, it } from 'vitest';
import {
  CLAUDE_CODE_KEYS,
  ConnectError,
  claudeCodeEnv,
  connect,
  describe,
  disconnect,
  parseSettings,
} from '../src/index';

const token = `apt_tel_${'A'.repeat(32)}`;
const env = claudeCodeEnv({ token, gatewayUrl: 'https://gw.example.com/' });

group('claudeCodeEnv', () => {
  it('turns on metrics only, as http/json with delta temporality, to the gateway’s /otlp', () => {
    expect(env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://gw.example.com/otlp',
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
    });
    expect(Object.keys(env).sort()).toEqual([...CLAUDE_CODE_KEYS].sort());
    expect(claudeCodeEnv({ token, gatewayUrl: 'https://example.com/gw' }).OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
      'https://example.com/gw/otlp',
    );
  });

  it('refuses things that aren’t telemetry tokens, and plain-http gateways other than localhost', () => {
    for (const bad of ['apk_live_abc', `apt_tel_${'A'.repeat(31)}`, `${token}\nX=1`, ''])
      expect(() => claudeCodeEnv({ token: bad, gatewayUrl: 'https://gw.example.com' })).toThrow(ConnectError);
    expect(() => claudeCodeEnv({ token, gatewayUrl: 'http://gw.example.com' })).toThrow(/https/);
    expect(() => claudeCodeEnv({ token, gatewayUrl: 'not a url' })).toThrow(ConnectError);
    expect(claudeCodeEnv({ token, gatewayUrl: 'http://localhost:8787' }).OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
      'http://localhost:8787/otlp',
    );
  });
});

group('connect and disconnect', () => {
  const existing = {
    model: 'opus',
    permissions: { allow: ['Bash(ls:*)'] },
    env: { MY_VAR: 'keep', OTEL_LOG_USER_PROMPTS: '1', OTEL_METRICS_EXPORTER: 'console' },
  };

  it('adds our keys, keeps everything else, and turns prompt logging off', () => {
    const plan = connect(existing, env);
    expect(plan.settings).toMatchObject({ model: 'opus', permissions: { allow: ['Bash(ls:*)'] } });
    expect(plan.settings.env).toMatchObject({ ...env, MY_VAR: 'keep', OTEL_LOG_USER_PROMPTS: '0' });
    expect(plan.changes).toContainEqual({ key: 'OTEL_METRICS_EXPORTER', before: 'console', after: 'otlp' });
    expect(plan.changes).toContainEqual({ key: 'OTEL_LOG_USER_PROMPTS', before: '1', after: '0' });
    expect(connect(plan.settings, env).changes).toEqual([]);
  });

  it('undo removes only our keys, and drops an env block it leaves empty', () => {
    const undone = disconnect(connect(existing, env).settings);
    expect(undone.settings.env).toEqual({ MY_VAR: 'keep', OTEL_LOG_USER_PROMPTS: '0' });
    expect(undone.changes.map((c) => c.key)).toEqual(expect.arrayContaining(['OTEL_EXPORTER_OTLP_HEADERS']));
    expect(disconnect(connect({}, env).settings).settings).toEqual({});
    expect(disconnect({ model: 'opus' })).toEqual({ settings: { model: 'opus' }, changes: [] });
  });

  it('property: connect then undo restores any settings that had none of our keys', () => {
    const key = fc.string({ minLength: 1 }).filter((k) => !(CLAUDE_CODE_KEYS as readonly string[]).includes(k));
    fc.assert(
      fc.property(
        fc.dictionary(key, fc.string()),
        fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
        (vars, rest) => {
          const settings = { ...rest, env: { ...vars } };
          const back = disconnect(connect(settings, env).settings).settings;
          const logging = Object.fromEntries(
            Object.keys(vars)
              .filter((k) => k === 'OTEL_LOG_USER_PROMPTS' || k === 'OTEL_LOG_TOOL_DETAILS')
              .map((k) => [k, '0']),
          );
          const expectedEnv = { ...vars, ...logging };
          expect(back).toEqual(
            Object.keys(expectedEnv).length === 0
              ? (({ env: _e, ...r }) => r)(settings)
              : { ...settings, env: expectedEnv },
          );
        },
      ),
    );
  });

  it('never writes over a settings file it can’t read', () => {
    expect(() => parseSettings('{ "model": ')).toThrow(/not valid JSON/);
    expect(() => parseSettings('[]')).toThrow(/not a JSON object/);
    expect(() => connect({ env: 'nope' }, env)).toThrow(/"env"/);
    expect(parseSettings(undefined)).toEqual({});
    expect(parseSettings('  \n')).toEqual({});
  });

  it('masks the token in the printed diff', () => {
    const text = describe(connect({}, env).changes);
    expect(text).toContain('+ OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer apt_tel_AAAA…');
    expect(text).not.toContain(token);
  });
});
