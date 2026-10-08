import { z } from 'zod';
import { ConnectorError, ProviderHttp } from '../http';
import {
  credentialFingerprint,
  daysBetween,
  type SeatConnector,
  type SeatConnectorOptions,
  type SeatDay,
  type SeatRecord,
} from './types';

/*
 * Two Anthropic analytics APIs (platform.claude.com/docs/en/manage-claude/analytics-api, read
 * 2026-10-08), with different keys:
 * - Claude Enterprise Analytics API: an Analytics API key (`read:analytics`) made by the primary
 *   owner in claude.ai; per-user daily activity under /v1/organizations/analytics/. Data from
 *   2026-01-01, with about a one-day lag; 60 requests per minute per org.
 * - Claude Code Analytics API: an Admin API key; per-user daily Claude Code metrics at
 *   /v1/organizations/usage_report/claude_code, including estimated cost per model in cents.
 */
const ANTHROPIC_API_URL = 'https://api.anthropic.com';
const VERSION = '2023-06-01';
/** Enterprise analytics days are revised for a few days, so the last few are re-read each sync. */
const MAX_DAYS_PER_SYNC = 7;

const http = (options: SeatConnectorOptions) =>
  new ProviderHttp({
    baseUrl: ANTHROPIC_API_URL,
    headers: { 'x-api-key': options.secret, 'anthropic-version': VERSION, 'user-agent': 'Aperture/1.0 (seat sync)' },
    fetch: options.fetch,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConnectorError('invalid_response', `unexpected ${what} response from Anthropic`);
  return result.data;
}

const n = z.number().nullish();
const userActivity = z.object({
  data: z.array(
    z
      .object({
        user: z.object({ id: z.string(), email_address: z.string() }).nullish(),
        last_activity_date: z.string().nullish(),
        chat_metrics: z.object({ message_count: n }).loose().nullish(),
        claude_code_metrics: z
          .object({
            core_metrics: z
              .object({
                distinct_session_count: n,
                commit_count: n,
                pull_request_count: n,
                lines_of_code: z.object({ added_count: n, removed_count: n }).nullish(),
              })
              .loose()
              .nullish(),
          })
          .loose()
          .nullish(),
        cowork_metrics: z.object({ message_count: n }).loose().nullish(),
      })
      .loose(),
  ),
  next_page: z.string().nullish(),
});

/** The latest day the Enterprise Analytics API serves: data lags about one day. */
const latestAnalyticsDay = (until: Date) => new Date(until.getTime() - 86_400_000);

export function claudeEnterpriseSeatConnector(options: SeatConnectorOptions): SeatConnector {
  const api = http(options);

  async function usersFor(query: Record<string, string>) {
    const rows: z.infer<typeof userActivity>['data'] = [];
    let page: string | undefined;
    for (let i = 0; i < 100; i += 1) {
      const params = new URLSearchParams({ ...query, limit: '1000', ...(page === undefined ? {} : { page }) });
      const body = parse(
        userActivity,
        await api.json('GET', '/v1/organizations/analytics/users', undefined, params),
        'user activity',
      );
      rows.push(...body.data);
      if (body.next_page == null) break;
      page = body.next_page;
    }
    return rows;
  }

  return {
    provider: 'seat:claude_enterprise',
    toolId: 'claude',
    async test() {
      const day = latestAnalyticsDay(new Date(Date.now() - 86_400_000))
        .toISOString()
        .slice(0, 10);
      const params = new URLSearchParams({ date: day, limit: '1' });
      parse(
        userActivity,
        await api.json('GET', '/v1/organizations/analytics/users', undefined, params),
        'user activity',
      );
      return {
        fingerprint: await credentialFingerprint('claude-enterprise', options.secret),
        details: { checkedDay: day },
      };
    },
    async listSeats() {
      // Range mode: one row per member over the window, with their last active day.
      const until = latestAnalyticsDay(new Date());
      const since = new Date(until.getTime() - 30 * 86_400_000);
      const rows = await usersFor({
        starting_date: since.toISOString().slice(0, 10),
        ending_date: until.toISOString().slice(0, 10),
      });
      return rows.flatMap((row): SeatRecord[] =>
        row.user == null
          ? []
          : [
              {
                externalId: row.user.id,
                email: row.user.email_address.toLowerCase(),
                name: null,
                plan: 'enterprise',
                active: true,
                lastActiveAt: row.last_activity_date == null ? null : new Date(`${row.last_activity_date}T00:00:00Z`),
              },
            ],
      );
    },
    async usage(since, until) {
      const latest = latestAnalyticsDay(until);
      const days = daysBetween(since, latest)
        .slice(-MAX_DAYS_PER_SYNC)
        .filter((d) => d >= '2026-01-01');
      const out: SeatDay[] = [];
      for (const day of days) {
        for (const row of await usersFor({ date: day })) {
          if (row.user == null) continue;
          const core = row.claude_code_metrics?.core_metrics;
          const messages = (row.chat_metrics?.message_count ?? 0) + (row.cowork_metrics?.message_count ?? 0);
          const sessions = core?.distinct_session_count ?? 0;
          out.push({
            externalId: row.user.id,
            email: row.user.email_address.toLowerCase(),
            day,
            active: messages + sessions > 0 || row.last_activity_date === day,
            requests: messages + sessions,
            tokens: 0n,
            sessions,
            commits: core?.commit_count ?? undefined,
            pullRequests: core?.pull_request_count ?? undefined,
            linesAdded: core?.lines_of_code?.added_count ?? undefined,
            linesRemoved: core?.lines_of_code?.removed_count ?? undefined,
          });
        }
      }
      return out;
    },
  };
}

const claudeCodeReport = z.object({
  data: z.array(
    z
      .object({
        date: z.string(),
        actor: z
          .object({ type: z.string(), email_address: z.string().nullish(), api_key_name: z.string().nullish() })
          .loose(),
        customer_type: z.string().nullish(),
        core_metrics: z
          .object({
            num_sessions: n,
            commits_by_claude_code: n,
            pull_requests_by_claude_code: n,
            lines_of_code: z.object({ added: n, removed: n }).nullish(),
          })
          .loose()
          .nullish(),
        model_breakdown: z
          .array(
            z
              .object({
                model: z.string(),
                tokens: z.object({ input: n, output: n, cache_read: n, cache_creation: n }).loose().nullish(),
                estimated_cost: z.object({ amount: n, currency: z.string().nullish() }).loose().nullish(),
              })
              .loose(),
          )
          .nullish(),
      })
      .loose(),
  ),
  has_more: z.boolean().nullish(),
  next_page: z.string().nullish(),
});

const tokens = (value: number | null | undefined) => BigInt(Math.max(0, Math.round(value ?? 0)));

export function claudeCodeSeatConnector(options: SeatConnectorOptions): SeatConnector {
  const api = http(options);

  async function day(date: string) {
    const rows: z.infer<typeof claudeCodeReport>['data'] = [];
    let page: string | undefined;
    for (let i = 0; i < 100; i += 1) {
      const params = new URLSearchParams({ starting_at: date, limit: '1000', ...(page === undefined ? {} : { page }) });
      const body = parse(
        claudeCodeReport,
        await api.json('GET', '/v1/organizations/usage_report/claude_code', undefined, params),
        'Claude Code report',
      );
      rows.push(...body.data);
      if (body.has_more !== true || body.next_page == null) break;
      page = body.next_page;
    }
    return rows;
  }

  const toDay = (date: string, row: z.infer<typeof claudeCodeReport>['data'][number]): SeatDay | undefined => {
    const email = row.actor.email_address?.toLowerCase() ?? null;
    const externalId = email ?? row.actor.api_key_name ?? null;
    if (externalId === null) return undefined;
    const models = (row.model_breakdown ?? []).map((m) => ({
      model: m.model,
      inputTokens: tokens(m.tokens?.input),
      outputTokens: tokens(m.tokens?.output),
      cacheReadTokens: tokens(m.tokens?.cache_read),
      cacheWriteTokens: tokens(m.tokens?.cache_creation),
      // estimated_cost.amount is in cents of USD.
      cost: tokens(m.estimated_cost?.amount) * 10_000n,
    }));
    const sessions = row.core_metrics?.num_sessions ?? 0;
    return {
      externalId,
      email,
      day: date,
      active: sessions > 0,
      requests: sessions,
      tokens: models.reduce(
        (sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens,
        0n,
      ),
      sessions,
      models,
      commits: row.core_metrics?.commits_by_claude_code ?? undefined,
      pullRequests: row.core_metrics?.pull_requests_by_claude_code ?? undefined,
      linesAdded: row.core_metrics?.lines_of_code?.added ?? undefined,
      linesRemoved: row.core_metrics?.lines_of_code?.removed ?? undefined,
    };
  };

  return {
    provider: 'seat:claude_code',
    toolId: 'claude_code',
    async test() {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const rows = await day(yesterday);
      return {
        fingerprint: await credentialFingerprint('claude-code', options.secret),
        details: { usersYesterday: rows.length },
      };
    },
    async listSeats() {
      const seen = new Map<string, SeatRecord>();
      const until = new Date();
      for (const date of daysBetween(new Date(until.getTime() - 14 * 86_400_000), until)) {
        for (const row of await day(date)) {
          const parsed = toDay(date, row);
          if (parsed === undefined) continue;
          const previous = seen.get(parsed.externalId);
          const lastActiveAt = parsed.active ? new Date(`${date}T00:00:00Z`) : (previous?.lastActiveAt ?? null);
          seen.set(parsed.externalId, {
            externalId: parsed.externalId,
            email: parsed.email,
            name: row.actor.api_key_name ?? null,
            plan: row.customer_type === 'subscription' ? 'subscription' : 'api',
            active: true,
            lastActiveAt,
          });
        }
      }
      return [...seen.values()];
    },
    async usage(since, until) {
      const out: SeatDay[] = [];
      for (const date of daysBetween(since, until).slice(-MAX_DAYS_PER_SYNC)) {
        for (const row of await day(date)) {
          const parsed = toDay(date, row);
          if (parsed !== undefined) out.push(parsed);
        }
      }
      return out;
    },
  };
}
