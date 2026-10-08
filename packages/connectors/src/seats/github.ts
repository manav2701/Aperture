import { z } from 'zod';
import { ConnectorError, ProviderHttp } from '../http';
import { utcDay, type SeatConnector, type SeatConnectorOptions, type SeatDay, type SeatRecord } from './types';

/*
 * GitHub Copilot seats (docs.github.com/en/rest/copilot/copilot-user-management, read
 * 2026-10-08): GET /orgs/{org}/copilot/billing/seats with a token holding `manage_billing:copilot`
 * or `read:org`. GitHub reports logins, not emails: seats are matched to members by the email an
 * admin links, or stay unmatched until someone assigns them.
 */
const GITHUB_API_URL = 'https://api.github.com';
const ORG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const seatsSchema = z.object({
  total_seats: z.number().nullish(),
  seats: z.array(
    z
      .object({
        assignee: z.object({ login: z.string(), id: z.number(), email: z.string().nullish() }).loose().nullish(),
        last_activity_at: z.string().nullish(),
        pending_cancellation_date: z.string().nullish(),
        plan_type: z.string().nullish(),
        created_at: z.string(),
      })
      .loose(),
  ),
});
const billingSchema = z.object({ seat_breakdown: z.object({ total: z.number() }).loose().nullish() }).loose();

export function githubCopilotSeatConnector(options: SeatConnectorOptions): SeatConnector {
  const org = typeof options.config.org === 'string' ? options.config.org : '';
  if (!ORG.test(org)) throw new ConnectorError('bad_request', 'set the GitHub organization (its login, e.g. acme-inc)');
  const api = new ProviderHttp({
    baseUrl: GITHUB_API_URL,
    headers: {
      authorization: `Bearer ${options.secret}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Aperture-seat-sync',
    },
    fetch: options.fetch,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });

  async function allSeats() {
    const seats: z.infer<typeof seatsSchema>['seats'] = [];
    for (let page = 1; page <= 100; page += 1) {
      const params = new URLSearchParams({ per_page: '100', page: String(page) });
      const parsed = seatsSchema.safeParse(
        await api.json('GET', `/orgs/${org}/copilot/billing/seats`, undefined, params),
      );
      if (!parsed.success)
        throw new ConnectorError('invalid_response', 'unexpected Copilot seats response from GitHub');
      seats.push(...parsed.data.seats);
      if (parsed.data.seats.length < 100) break;
    }
    return seats;
  }

  return {
    provider: 'seat:github_copilot',
    toolId: 'github_copilot',
    async test() {
      const parsed = billingSchema.safeParse(await api.json('GET', `/orgs/${org}/copilot/billing`));
      if (!parsed.success)
        throw new ConnectorError('invalid_response', 'unexpected Copilot billing response from GitHub');
      return { fingerprint: `github:${org.toLowerCase()}`, details: { seats: parsed.data.seat_breakdown?.total ?? 0 } };
    },
    async listSeats() {
      return (await allSeats()).flatMap((seat): SeatRecord[] =>
        seat.assignee == null
          ? []
          : [
              {
                externalId: seat.assignee.login,
                email: seat.assignee.email?.toLowerCase() ?? null,
                name: seat.assignee.login,
                plan: seat.plan_type === 'enterprise' ? 'enterprise' : 'business',
                active: seat.pending_cancellation_date == null,
                lastActiveAt: seat.last_activity_at == null ? null : new Date(seat.last_activity_at),
              },
            ],
      );
    },
    async usage(since, until) {
      // Copilot's seat API reports only the last activity; that day counts as active.
      return (await allSeats()).flatMap((seat): SeatDay[] => {
        if (seat.assignee == null || seat.last_activity_at == null) return [];
        const at = new Date(seat.last_activity_at);
        if (at < since || at >= until) return [];
        return [
          {
            externalId: seat.assignee.login,
            email: seat.assignee.email?.toLowerCase() ?? null,
            day: utcDay(at),
            active: true,
            requests: 0,
            tokens: 0n,
          },
        ];
      });
    },
  };
}
