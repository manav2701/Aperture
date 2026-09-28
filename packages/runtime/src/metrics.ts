import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';

/*
 * Prometheus-format metrics (plan/phases/phase-10 §10.3), dependency-free. Each service exposes
 * GET /metrics (bearer METRICS_TOKEN; absent without it); Grafana Alloy or any Prometheus
 * scraper ships them to Grafana Cloud for the dashboards and alerts in docs/runbooks.
 */

type Labels = Record<string, string>;

const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
const HELP: Record<string, string> = {
  aperture_http_requests_total: 'HTTP requests by route and status',
  aperture_http_request_duration_ms: 'HTTP request duration (ms) by route',
};

const key = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((name) => `${name}="${(labels[name] ?? '').replace(/["\\\n]/g, '_')}"`)
    .join(',');

class Registry {
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly histograms = new Map<string, Map<string, { buckets: number[]; sum: number; count: number }>>();

  inc(name: string, labels: Labels = {}, by = 1): void {
    const series = this.counters.get(name) ?? new Map<string, number>();
    const id = key(labels);
    series.set(id, (series.get(id) ?? 0) + by);
    this.counters.set(name, series);
  }

  observe(name: string, labels: Labels, value: number): void {
    const series = this.histograms.get(name) ?? new Map<string, { buckets: number[]; sum: number; count: number }>();
    const id = key(labels);
    const entry = series.get(id) ?? { buckets: BUCKETS_MS.map(() => 0), sum: 0, count: 0 };
    BUCKETS_MS.forEach((bound, index) => {
      if (value <= bound) entry.buckets[index] = (entry.buckets[index] ?? 0) + 1;
    });
    entry.sum += value;
    entry.count += 1;
    series.set(id, entry);
    this.histograms.set(name, series);
  }

  describe(name: string, help: string): void {
    HELP[name] = help;
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.counters) {
      lines.push(`# HELP ${name} ${HELP[name] ?? name}`, `# TYPE ${name} counter`);
      for (const [labels, value] of series) lines.push(`${name}${labels === '' ? '' : `{${labels}}`} ${String(value)}`);
    }
    for (const [name, series] of this.histograms) {
      lines.push(`# HELP ${name} ${HELP[name] ?? name}`, `# TYPE ${name} histogram`);
      for (const [labels, entry] of series) {
        const prefix = labels === '' ? '' : `${labels},`;
        BUCKETS_MS.forEach((bound, index) => {
          lines.push(`${name}_bucket{${prefix}le="${String(bound)}"} ${String(entry.buckets[index] ?? 0)}`);
        });
        lines.push(`${name}_bucket{${prefix}le="+Inf"} ${String(entry.count)}`);
        lines.push(`${name}_sum${labels === '' ? '' : `{${labels}}`} ${String(entry.sum)}`);
        lines.push(`${name}_count${labels === '' ? '' : `{${labels}}`} ${String(entry.count)}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

/** The process-wide registry. */
export const metrics = new Registry();

/** Counts and times every request by its route pattern (never the raw path: ids stay out of labels). */
export function metricsMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const pattern = routePath(c);
    const route = pattern === '/*' || pattern === '*' ? 'unmatched' : pattern;
    metrics.inc('aperture_http_requests_total', { method: c.req.method, route, status: String(c.res.status) });
    metrics.observe('aperture_http_request_duration_ms', { route }, performance.now() - started);
  };
}

export function metricsAuthorized(token: string | undefined, header: string | undefined): boolean {
  if (token === undefined || token === '') return false;
  const given = Buffer.from(header?.startsWith('Bearer ') === true ? header.slice(7) : '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
