import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mapOtlpMetrics, otlpMetricsSchema, telemetryToolOf } from './telemetry';

const nano = (iso: string) => String(BigInt(Date.parse(iso)) * 1_000_000n);
const str = (key: string, value: string) => ({ key, value: { stringValue: value } });

/** An export in the shape Claude Code sends (OTLP JSON, delta sums). */
function claudeCodeExport(
  options: { temporality?: number; extraAttributes?: { key: string; value: { stringValue: string } }[] } = {},
) {
  const time = nano('2026-10-07T10:00:00Z');
  const base = [str('user.email', 'Dev@Acme.example'), str('session.id', 's-1'), ...(options.extraAttributes ?? [])];
  const sum = (
    points: { value: number; attributes?: { key: string; value: { stringValue: string } }[] }[],
    asInt = false,
  ) => ({
    aggregationTemporality: options.temporality ?? 1,
    isMonotonic: true,
    dataPoints: points.map((p) => ({
      timeUnixNano: time,
      attributes: [...base, ...(p.attributes ?? [])],
      ...(asInt ? { asInt: String(p.value) } : { asDouble: p.value }),
    })),
  });
  return {
    resourceMetrics: [
      {
        resource: { attributes: [str('service.name', 'claude-code'), str('service.version', '2.1.290')] },
        scopeMetrics: [
          {
            metrics: [
              { name: 'claude_code.session.count', sum: sum([{ value: 2 }], true) },
              {
                name: 'claude_code.token.usage',
                unit: 'tokens',
                sum: sum([
                  { value: 1200, attributes: [str('type', 'input'), str('model', 'claude-sonnet-5-5')] },
                  { value: 300, attributes: [str('type', 'output'), str('model', 'claude-sonnet-5-5')] },
                  { value: 9000, attributes: [str('type', 'cacheRead'), str('model', 'claude-sonnet-5-5')] },
                  { value: 500, attributes: [str('type', 'cacheCreation'), str('model', 'claude-sonnet-5-5')] },
                ]),
              },
              {
                name: 'claude_code.cost.usage',
                unit: 'USD',
                sum: sum([
                  { value: 0.0123456, attributes: [str('model', 'claude-sonnet-5-5')] },
                  { value: 0.0000004, attributes: [str('model', 'claude-sonnet-5-5')] },
                ]),
              },
              {
                name: 'claude_code.lines_of_code.count',
                sum: sum([
                  { value: 40, attributes: [str('type', 'added')] },
                  { value: 7, attributes: [str('type', 'removed')] },
                ]),
              },
              { name: 'claude_code.commit.count', sum: sum([{ value: 1 }]) },
              {
                name: 'claude_code.active_time.total',
                unit: 's',
                sum: sum([{ value: 95.4, attributes: [str('type', 'user')] }]),
              },
              { name: 'something.else', sum: sum([{ value: 1 }]) },
            ],
          },
        ],
      },
    ],
  };
}

describe('mapOtlpMetrics', () => {
  it('turns a Claude Code export into daily rows per model', () => {
    const mapped = mapOtlpMetrics(otlpMetricsSchema.parse(claudeCodeExport()));
    const sonnet = mapped.rows.find((r) => r.model === 'claude-sonnet-5-5');
    const noModel = mapped.rows.find((r) => r.model === '-');
    expect(sonnet).toMatchObject({
      tool: 'claude_code',
      day: '2026-10-07',
      email: 'dev@acme.example',
      inputTokens: 1200n,
      outputTokens: 300n,
      cacheReadTokens: 9000n,
      cacheWriteTokens: 500n,
      costMicros: 12_346n,
    });
    expect(noModel).toMatchObject({ sessions: 2, linesAdded: 40, linesRemoved: 7, commits: 1, activeSeconds: 95 });
    expect(mapped.unknownMetrics).toEqual(['something.else']);
    expect(mapped.cumulativeIgnored).toBe(0);
  });

  it('ignores cumulative points instead of double counting them', () => {
    const mapped = mapOtlpMetrics(otlpMetricsSchema.parse(claudeCodeExport({ temporality: 2 })));
    expect(mapped.rows).toEqual([]);
    expect(mapped.cumulativeIgnored).toBeGreaterThan(0);
  });

  it('keeps no attribute outside the allow list, even if a client sends prompt text', () => {
    const exported = claudeCodeExport({
      extraAttributes: [str('prompt', 'SECRET customer contract text'), str('tool_input', 'rm -rf /')],
    });
    const serialized = JSON.stringify(mapOtlpMetrics(otlpMetricsSchema.parse(exported)), (_, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('rm -rf');
  });

  it('only reads exports from known tools', () => {
    expect(telemetryToolOf('claude-code')).toBe('claude_code');
    expect(telemetryToolOf('my-app')).toBeUndefined();
  });

  it('never throws on arbitrary JSON (fuzz)', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 6 }), (value) => {
        const parsed = otlpMetricsSchema.safeParse(value);
        if (parsed.success) expect(Array.isArray(mapOtlpMetrics(parsed.data).rows)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
