import { z } from 'zod';
import { ConnectorError, ProviderHttp, type FetchLike } from '../http';
import { utcDay, type SeatConnector, type SeatConnectorOptions, type SeatDay, type SeatRecord } from './types';

/*
 * Microsoft 365 Copilot usage (learn.microsoft.com/graph/api/reportroot-getmicrosoft365copilotusageuserdetail,
 * read 2026-10-08): GET /beta/reports/getMicrosoft365CopilotUsageUserDetail(period='D30') with an
 * app token holding Reports.Read.All (client credentials). Microsoft says the API is moving under
 * /copilot; VERIFY before relying on it. Tenants that conceal user names in reports return hashes
 * instead of user principal names, so seats then can't be matched to members.
 */
const GRAPH_URL = 'https://graph.microsoft.com';
const LOGIN_URL = 'https://login.microsoftonline.com';
const TENANT = /^([0-9a-f-]{36}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

const secretSchema = z.object({
  tenantId: z.string().regex(TENANT),
  clientId: z.string().min(1).max(100),
  clientSecret: z.string().min(1).max(500),
});
const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional() });
const reportSchema = z.object({
  '@odata.nextLink': z.string().nullish(),
  value: z.array(
    z
      .object({
        userPrincipalName: z.string(),
        displayName: z.string().nullish(),
        lastActivityDate: z.string().nullish(),
      })
      .loose(),
  ),
});

async function appToken(secret: z.infer<typeof secretSchema>, fetcher: FetchLike): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: secret.clientId,
    client_secret: secret.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });
  let response: Response;
  try {
    response = await fetcher(`${LOGIN_URL}/${encodeURIComponent(secret.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ConnectorError('unavailable', `could not reach Microsoft sign-in: ${(error as Error).message}`);
  }
  if (!response.ok)
    throw new ConnectorError(
      response.status === 400 || response.status === 401 ? 'unauthorized' : 'unavailable',
      `Microsoft sign-in answered ${String(response.status)}`,
      response.status,
    );
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ConnectorError('invalid_response', 'unexpected token response from Microsoft');
  return parsed.data.access_token;
}

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function m365CopilotSeatConnector(options: SeatConnectorOptions): SeatConnector {
  let secret: z.infer<typeof secretSchema>;
  try {
    secret = secretSchema.parse(JSON.parse(options.secret));
  } catch {
    throw new ConnectorError('bad_request', 'paste JSON with tenantId, clientId, and clientSecret');
  }
  const fetcher: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function report() {
    const token = await appToken(secret, fetcher);
    const api = new ProviderHttp({
      baseUrl: GRAPH_URL,
      headers: { authorization: `Bearer ${token}` },
      fetch: fetcher,
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    });
    const rows: z.infer<typeof reportSchema>['value'] = [];
    let path = "/beta/reports/getMicrosoft365CopilotUsageUserDetail(period='D30')";
    let query: URLSearchParams | undefined = new URLSearchParams({ $format: 'application/json' });
    for (let i = 0; i < 200; i += 1) {
      const parsed = reportSchema.safeParse(await api.json('GET', path, undefined, query));
      if (!parsed.success)
        throw new ConnectorError('invalid_response', 'unexpected Copilot usage report from Microsoft Graph');
      rows.push(...parsed.data.value);
      const next = parsed.data['@odata.nextLink'];
      if (next == null) break;
      // Only follow links back to Graph itself.
      const url = new URL(next);
      if (url.origin !== GRAPH_URL)
        throw new ConnectorError('invalid_response', 'Microsoft Graph returned a next link to another host');
      path = url.pathname;
      query = url.searchParams;
    }
    return rows;
  }

  return {
    provider: 'seat:m365_copilot',
    toolId: 'microsoft_copilot',
    async test() {
      const rows = await report();
      return { fingerprint: `m365:${secret.tenantId.toLowerCase()}`, details: { users: rows.length } };
    },
    async listSeats() {
      return (await report()).map((row): SeatRecord => ({
        externalId: row.userPrincipalName,
        email: looksLikeEmail(row.userPrincipalName) ? row.userPrincipalName.toLowerCase() : null,
        name: row.displayName ?? null,
        plan: 'm365_copilot',
        active: true,
        lastActiveAt:
          row.lastActivityDate == null || row.lastActivityDate === ''
            ? null
            : new Date(`${row.lastActivityDate}T00:00:00Z`),
      }));
    },
    async usage(since, until) {
      return (await report()).flatMap((row): SeatDay[] => {
        if (row.lastActivityDate == null || row.lastActivityDate === '') return [];
        const at = new Date(`${row.lastActivityDate}T00:00:00Z`);
        if (at < since || at >= until) return [];
        return [
          {
            externalId: row.userPrincipalName,
            email: looksLikeEmail(row.userPrincipalName) ? row.userPrincipalName.toLowerCase() : null,
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
