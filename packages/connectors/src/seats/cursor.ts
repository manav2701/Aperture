import { z } from 'zod';
import { ConnectorError, ProviderHttp } from '../http';
import {
  credentialFingerprint,
  utcDay,
  type SeatConnector,
  type SeatConnectorOptions,
  type SeatDay,
  type SeatRecord,
} from './types';

/*
 * Cursor Admin API (cursor.com/docs/account/teams/admin-api, read 2026-10-08): Basic auth with
 * the admin key as the username. Daily usage is aggregated hourly (poll at most hourly, 20
 * requests/minute per team) and one request covers at most 30 days.
 */
const CURSOR_ADMIN_URL = 'https://api.cursor.com';
const MAX_WINDOW_MS = 30 * 86_400_000;
const PAGE_SIZE = 500;

const membersSchema = z.object({
  teamMembers: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).optional(),
      email: z.string(),
      name: z.string().nullish(),
      role: z.string().nullish(),
      isRemoved: z.boolean().nullish(),
    }),
  ),
});

const dailySchema = z.object({
  data: z.array(
    z
      .object({
        userId: z.union([z.string(), z.number()]).nullish(),
        email: z.string().nullish(),
        date: z.number().nullish(),
        day: z.string().nullish(),
        isActive: z.boolean().nullish(),
        composerRequests: z.number().nullish(),
        chatRequests: z.number().nullish(),
        agentRequests: z.number().nullish(),
        cmdkUsages: z.number().nullish(),
        totalTabsAccepted: z.number().nullish(),
        totalLinesAdded: z.number().nullish(),
        totalLinesDeleted: z.number().nullish(),
      })
      .loose(),
  ),
  pagination: z.object({ hasNextPage: z.boolean() }).loose().nullish(),
});

const spendSchema = z.object({
  teamMemberSpend: z.array(
    z
      .object({
        email: z.string(),
        spendCents: z.number().nullish(),
        userId: z.union([z.string(), z.number()]).nullish(),
      })
      .loose(),
  ),
  subscriptionCycleStart: z.union([z.number(), z.string()]).nullish(),
  totalPages: z.number().nullish(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConnectorError('invalid_response', `unexpected ${what} response from Cursor`);
  return result.data;
}

export function cursorSeatConnector(options: SeatConnectorOptions): SeatConnector {
  const http = new ProviderHttp({
    baseUrl: CURSOR_ADMIN_URL,
    headers: { authorization: `Basic ${btoa(`${options.secret}:`)}` },
    fetch: options.fetch,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });

  const members = async () => parse(membersSchema, await http.json('GET', '/teams/members'), 'members').teamMembers;

  /** Usage-based spend per member in the current billing cycle. */
  const cycleSpend = async () => {
    const byEmail = new Map<string, bigint>();
    let cycleStart: string | null = null;
    for (let page = 1; page <= 20; page += 1) {
      const body = parse(spendSchema, await http.json('POST', '/teams/spend', { page, pageSize: 100 }), 'spend');
      if (body.subscriptionCycleStart != null) cycleStart = utcDay(new Date(Number(body.subscriptionCycleStart)));
      for (const member of body.teamMemberSpend)
        byEmail.set(member.email.toLowerCase(), BigInt(Math.max(0, Math.round(member.spendCents ?? 0))) * 10_000n);
      if (body.totalPages == null || page >= body.totalPages) break;
    }
    return { byEmail, cycleStart };
  };

  return {
    provider: 'seat:cursor',
    toolId: 'cursor',
    async test() {
      const list = await members();
      return {
        fingerprint: await credentialFingerprint('cursor', options.secret),
        details: { members: list.filter((m) => m.isRemoved !== true).length },
      };
    },
    async listSeats() {
      const [list, spend] = await Promise.all([members(), cycleSpend()]);
      return list.map((member): SeatRecord => {
        const email = member.email.toLowerCase();
        const extra = spend.byEmail.get(email);
        return {
          externalId: String(member.id ?? email),
          email,
          name: member.name ?? null,
          plan: 'teams',
          active: member.isRemoved !== true,
          lastActiveAt: null,
          extraUsageCycle:
            extra === undefined || spend.cycleStart === null
              ? undefined
              : { cycleStart: spend.cycleStart, amount: extra },
        };
      });
    },
    async usage(since, until) {
      const days: SeatDay[] = [];
      const start = Math.max(since.getTime(), until.getTime() - MAX_WINDOW_MS);
      for (let page = 1; page <= 50; page += 1) {
        const body = parse(
          dailySchema,
          await http.json('POST', '/teams/daily-usage-data', {
            startDate: start,
            endDate: until.getTime(),
            page,
            pageSize: PAGE_SIZE,
          }),
          'daily usage',
        );
        for (const row of body.data) {
          const day = row.day ?? (row.date == null ? null : utcDay(new Date(row.date)));
          if (day === null || !/^\d{4}-\d{2}-\d{2}$/.test(day.slice(0, 10))) continue;
          const requests =
            (row.composerRequests ?? 0) + (row.chatRequests ?? 0) + (row.agentRequests ?? 0) + (row.cmdkUsages ?? 0);
          const email = row.email?.toLowerCase() ?? null;
          days.push({
            externalId: String(row.userId ?? email ?? ''),
            email,
            day: day.slice(0, 10),
            active: row.isActive ?? requests > 0,
            requests,
            tokens: 0n,
            linesAdded: row.totalLinesAdded ?? undefined,
            linesRemoved: row.totalLinesDeleted ?? undefined,
          });
        }
        if (body.pagination?.hasNextPage !== true) break;
      }
      return days;
    },
  };
}
