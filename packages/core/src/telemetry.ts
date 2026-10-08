import { z } from 'zod';

/*
 * Terminal-tool telemetry (plan/phases/phase-12 §12.5): OTLP metrics over HTTP/JSON, mapped to
 * daily usage per person, tool, and model. Mapping is an allow list: only the metrics and
 * attributes named here are read, so nothing that could carry prompt text, file paths, or tool
 * input is ever kept, whatever the client sends.
 *
 * Claude Code metric names and attributes are from code.claude.com/docs/en/monitoring-usage
 * (read 2026-10-08). Counters are delta temporality by default there; cumulative points are
 * counted and ignored (`@aperture/connect` and the managed-settings templates set delta).
 */

const anyValue = z
  .object({
    stringValue: z.string().max(1000).optional(),
    intValue: z.union([z.string(), z.number()]).optional(),
    doubleValue: z.number().optional(),
    boolValue: z.boolean().optional(),
  })
  .loose();

const keyValue = z.object({ key: z.string().max(200), value: anyValue.optional() }).loose();

const numberPoint = z
  .object({
    attributes: z.array(keyValue).max(64).optional(),
    startTimeUnixNano: z.union([z.string(), z.number()]).optional(),
    timeUnixNano: z.union([z.string(), z.number()]),
    asDouble: z.number().optional(),
    asInt: z.union([z.string(), z.number()]).optional(),
  })
  .loose();

const metric = z
  .object({
    name: z.string().max(200),
    unit: z.string().max(50).optional(),
    sum: z
      .object({
        dataPoints: z.array(numberPoint).max(10_000),
        aggregationTemporality: z.union([z.number(), z.string()]).optional(),
        isMonotonic: z.boolean().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export const otlpMetricsSchema = z.object({
  resourceMetrics: z
    .array(
      z
        .object({
          resource: z
            .object({ attributes: z.array(keyValue).max(128).optional() })
            .loose()
            .optional(),
          scopeMetrics: z
            .array(z.object({ metrics: z.array(metric).max(500).optional() }).loose())
            .max(100)
            .optional(),
        })
        .loose(),
    )
    .max(100),
});
export type OtlpMetricsRequest = z.infer<typeof otlpMetricsSchema>;

export const TELEMETRY_TOOLS = ['claude_code'] as const;
export type TelemetryTool = (typeof TELEMETRY_TOOLS)[number];

/** One person's usage of one tool and model on one UTC day; counters only add up. */
export interface ToolUsageRow {
  tool: TelemetryTool;
  /** `YYYY-MM-DD` in UTC. */
  day: string;
  model: string;
  /** From the `user.email` attribute when the client sends it (OAuth sign-in). */
  email: string | null;
  sessions: number;
  inputTokens: bigint;
  outputTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
  /** Estimated cost reported by the tool, in µUSD (list-price equivalent for subscription users). */
  costMicros: bigint;
  activeSeconds: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
}

export interface TelemetryMapping {
  rows: ToolUsageRow[];
  /** Data points read and kept. */
  accepted: number;
  /** Points with cumulative temporality (ignored; double counting otherwise). */
  cumulativeIgnored: number;
  /** Metric names not in the allow list (counted, never stored). */
  unknownMetrics: string[];
}

const DELTA = 1;
const NO_MODEL = '-';

function attributeMap(list: readonly z.infer<typeof keyValue>[] | undefined): Map<string, string | number> {
  const map = new Map<string, string | number>();
  for (const { key, value } of list ?? []) {
    if (value === undefined) continue;
    if (value.stringValue !== undefined) map.set(key, value.stringValue);
    else if (value.intValue !== undefined) map.set(key, Number(value.intValue));
    else if (value.doubleValue !== undefined) map.set(key, value.doubleValue);
  }
  return map;
}

const pointValue = (point: z.infer<typeof numberPoint>): number =>
  point.asDouble ?? (point.asInt === undefined ? 0 : Number(point.asInt));

function utcDay(unixNano: string | number): string | undefined {
  const ms = typeof unixNano === 'number' ? unixNano / 1e6 : Number(BigInt(unixNano) / 1_000_000n);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return new Date(ms).toISOString().slice(0, 10);
}

/** USD as a JS number (as the tool reports it) to µUSD, rounded to the nearest µUSD. */
function usdToMicros(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return BigInt(Math.round(usd * 1_000_000));
}

const wholeTokens = (value: number) => (Number.isFinite(value) && value > 0 ? BigInt(Math.round(value)) : 0n);
const wholeCount = (value: number) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

const CLAUDE_CODE_METRICS = new Set([
  'claude_code.session.count',
  'claude_code.token.usage',
  'claude_code.cost.usage',
  'claude_code.active_time.total',
  'claude_code.lines_of_code.count',
  'claude_code.commit.count',
  'claude_code.pull_request.count',
  // Read but not stored: no money or volume in it.
  'claude_code.code_edit_tool.decision',
]);

/** Which tool sent the batch, from the OTLP resource's `service.name`. */
export function telemetryToolOf(serviceName: string | undefined): TelemetryTool | undefined {
  return serviceName === 'claude-code' ? 'claude_code' : undefined;
}

/**
 * Maps an OTLP metrics export to daily usage rows. Rows with the same tool, day, model, and email
 * are merged. The caller decides which member the batch belongs to (the telemetry token's
 * owner), so the email attribute is only used to warn about a mismatch.
 */
export function mapOtlpMetrics(request: OtlpMetricsRequest): TelemetryMapping {
  const rows = new Map<string, ToolUsageRow>();
  const unknown = new Set<string>();
  let accepted = 0;
  let cumulativeIgnored = 0;
  for (const resourceMetrics of request.resourceMetrics) {
    const resource = attributeMap(resourceMetrics.resource?.attributes);
    const serviceName = resource.get('service.name');
    const tool = telemetryToolOf(typeof serviceName === 'string' ? serviceName : undefined);
    for (const scope of resourceMetrics.scopeMetrics ?? []) {
      for (const m of scope.metrics ?? []) {
        if (tool === undefined || !CLAUDE_CODE_METRICS.has(m.name)) {
          if (unknown.size < 50) unknown.add(m.name);
          continue;
        }
        if (m.sum === undefined) continue;
        if (m.sum.aggregationTemporality !== undefined && Number(m.sum.aggregationTemporality) !== DELTA) {
          cumulativeIgnored += m.sum.dataPoints.length;
          continue;
        }
        for (const point of m.sum.dataPoints) {
          const day = utcDay(point.timeUnixNano);
          if (day === undefined) continue;
          const attributes = new Map([...resource, ...attributeMap(point.attributes)]);
          const model = String(attributes.get('model') ?? NO_MODEL).slice(0, 100);
          const emailValue = attributes.get('user.email');
          const email = typeof emailValue === 'string' ? emailValue.toLowerCase().slice(0, 254) : null;
          const key = `${tool}|${day}|${model}|${email ?? ''}`;
          const row = rows.get(key) ?? {
            tool,
            day,
            model,
            email,
            sessions: 0,
            inputTokens: 0n,
            outputTokens: 0n,
            cacheReadTokens: 0n,
            cacheWriteTokens: 0n,
            costMicros: 0n,
            activeSeconds: 0,
            linesAdded: 0,
            linesRemoved: 0,
            commits: 0,
            pullRequests: 0,
          };
          const value = pointValue(point);
          switch (m.name) {
            case 'claude_code.session.count':
              row.sessions += wholeCount(value);
              break;
            case 'claude_code.token.usage': {
              const type = attributes.get('type');
              const tokens = wholeTokens(value);
              if (type === 'input') row.inputTokens += tokens;
              else if (type === 'output') row.outputTokens += tokens;
              else if (type === 'cacheRead') row.cacheReadTokens += tokens;
              else if (type === 'cacheCreation') row.cacheWriteTokens += tokens;
              break;
            }
            case 'claude_code.cost.usage':
              row.costMicros += usdToMicros(value);
              break;
            case 'claude_code.active_time.total':
              row.activeSeconds += wholeCount(value);
              break;
            case 'claude_code.lines_of_code.count':
              if (attributes.get('type') === 'added') row.linesAdded += wholeCount(value);
              else if (attributes.get('type') === 'removed') row.linesRemoved += wholeCount(value);
              break;
            case 'claude_code.commit.count':
              row.commits += wholeCount(value);
              break;
            case 'claude_code.pull_request.count':
              row.pullRequests += wholeCount(value);
              break;
            default:
              break;
          }
          rows.set(key, row);
          accepted += 1;
        }
      }
    }
  }
  return { rows: [...rows.values()], accepted, cumulativeIgnored, unknownMetrics: [...unknown] };
}
