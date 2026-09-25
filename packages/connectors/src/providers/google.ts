import { createSign } from 'node:crypto';
import { z } from 'zod';
import { ConnectorError, ProviderHttp, type FetchLike } from '../http';
import type { Connector, ConnectorOptions, ExternalKey } from '../types';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const API_KEYS_BASE_URL = 'https://apikeys.googleapis.com/v2';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const serviceAccountSchema = z.object({
  type: z.literal('service_account'),
  project_id: z.string().min(1),
  client_email: z.email(),
  private_key: z.string().min(1),
});
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number() });
const keysSchema = z.object({
  keys: z
    .array(z.object({ name: z.string(), uid: z.string().optional(), displayName: z.string().optional() }))
    .optional(),
  nextPageToken: z.string().optional(),
});
const modelsSchema = z.object({ models: z.array(z.object({ name: z.string() })).optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConnectorError('invalid_response', `unexpected Google ${what} response`);
  return result.data;
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** OAuth access token for a service account (JWT bearer grant, RFC 7523). */
async function serviceAccountToken(
  account: z.infer<typeof serviceAccountSchema>,
  fetchImpl: FetchLike,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: TOKEN_URL,
      iat: now,
      exp: now + 600,
    }),
  );
  let signature: string;
  try {
    signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key, 'base64url');
  } catch {
    throw new ConnectorError('bad_request', 'the service account private key is not a valid PEM key');
  }
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new ConnectorError('unauthorized', `Google rejected the service account (${String(response.status)})`);
  return parse(tokenSchema, await response.json(), 'token').access_token;
}

/**
 * Google Gemini. Two ways to connect:
 * - a Gemini API key only: the gateway can use it, and there is no usage API (T3);
 * - a service-account JSON (API Keys Admin): Aperture lists the project's API keys and deletes
 *   the ones mapped to a principal when a Cloud Billing budget notification crosses 100% (T2).
 */
export function googleConnector(options: ConnectorOptions): Connector {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const parsedAccount = (() => {
    try {
      return serviceAccountSchema.safeParse(JSON.parse(options.secret));
    } catch {
      return undefined;
    }
  })();
  const account = parsedAccount?.success === true ? parsedAccount.data : undefined;

  if (account === undefined) {
    const gemini = new ProviderHttp({
      baseUrl: GEMINI_BASE_URL,
      headers: { 'x-goog-api-key': options.secret },
      fetch: options.fetch,
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    });
    return {
      provider: 'google',
      capabilities: { createKey: false, setLimit: false, revoke: false, usage: 'none', tier: 'T3' },
      async test() {
        const models = parse(
          modelsSchema,
          await gemini.json('GET', '/v1beta/models', undefined, new URLSearchParams({ pageSize: '1' })),
          'models',
        );
        // An API key has no account id; its last characters identify it well enough for C9.
        return {
          fingerprint: `gemini-key:${options.secret.slice(-6)}`,
          details: { mode: 'api_key', models: models.models?.length ?? 0 },
        };
      },
      listKeys: () => Promise.resolve([]),
      revoke: () =>
        Promise.reject(new ConnectorError('unsupported', 'connect a service account to revoke Gemini keys')),
    };
  }

  let token: { value: string; expires: number } | undefined;
  const keysApi = async () => {
    if (token === undefined || token.expires < Date.now()) {
      token = { value: await serviceAccountToken(account, fetchImpl), expires: Date.now() + 9 * 60_000 };
    }
    return new ProviderHttp({
      baseUrl: API_KEYS_BASE_URL,
      headers: { authorization: `Bearer ${token.value}` },
      fetch: options.fetch,
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    });
  };
  const project = encodeURIComponent(account.project_id);

  return {
    provider: 'google',
    capabilities: { createKey: false, setLimit: false, revoke: true, usage: 'none', tier: 'T2' },

    async test() {
      const keys = await this.listKeys();
      return { fingerprint: account.project_id, details: { mode: 'service_account', keys: keys.length } };
    },

    async listKeys() {
      const http = await keysApi();
      const keys: ExternalKey[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const query = new URLSearchParams({ pageSize: '300', ...(pageToken === undefined ? {} : { pageToken }) });
        const result = parse(
          keysSchema,
          await http.json('GET', `/projects/${project}/locations/global/keys`, undefined, query),
          'keys',
        );
        keys.push(
          ...(result.keys ?? []).map((key) => ({
            // The resource name is what DELETE takes.
            externalId: key.name,
            name: key.displayName ?? key.uid ?? key.name,
            hint: null,
            disabled: false,
          })),
        );
        if (result.nextPageToken === undefined) break;
        pageToken = result.nextPageToken;
      }
      return keys;
    },

    async revoke(externalId) {
      if (!externalId.startsWith(`projects/`) || externalId.includes('..')) {
        throw new ConnectorError('bad_request', 'not a Google API key resource name');
      }
      const http = await keysApi();
      await http.json('DELETE', `/${externalId}`);
    },
  };
}

/** A Cloud Billing budget notification (Pub/Sub message `data`, base64 JSON). */
export const budgetNotificationSchema = z.object({
  budgetDisplayName: z.string(),
  costAmount: z.number(),
  budgetAmount: z.number(),
  alertThresholdExceeded: z.number().optional(),
  currencyCode: z.string(),
  costIntervalStart: z.string().optional(),
});
export type BudgetNotification = z.infer<typeof budgetNotificationSchema>;
