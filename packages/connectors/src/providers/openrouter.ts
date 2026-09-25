import { z } from 'zod';
import { dollarsToMicros, microsToDollars } from '../amounts';
import { ConnectorError, ProviderHttp } from '../http';
import type { Connector, ConnectorOptions, CreatedKey, ExternalKey } from '../types';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const keySchema = z.object({
  hash: z.string().min(1),
  name: z.string(),
  label: z.string().nullish(),
  disabled: z.boolean(),
  usage: z.number(),
  limit: z.number().nullable(),
});
const listSchema = z.object({ data: z.array(keySchema) });
const createSchema = z.object({ data: keySchema, key: z.string().min(1) });
const currentKeySchema = z.object({
  data: z.object({
    is_management_key: z.boolean().optional(),
    is_provisioning_key: z.boolean().optional(),
    label: z.string().nullish(),
    organization_id: z.string().nullish(),
    creator_user_id: z.string().nullish(),
  }),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConnectorError('invalid_response', `unexpected OpenRouter ${what} response`);
  return result.data;
}

const toKey = (key: z.infer<typeof keySchema>): ExternalKey => ({
  externalId: key.hash,
  name: key.name,
  hint: key.label ?? null,
  disabled: key.disabled,
  usage: dollarsToMicros(key.usage, 'usage'),
  limit: key.limit === null ? null : dollarsToMicros(key.limit, 'limit'),
});

/**
 * OpenRouter with a management (provisioning) key. Keys created here carry a hard dollar limit
 * that Aperture keeps equal to "lifetime usage + remaining budget", so OpenRouter itself stops
 * the key when the budget runs out (T1). `limit_reset` stays null: OpenRouter resets on UTC
 * boundaries, which don't match the org's time zone.
 */
export function openRouterConnector(options: ConnectorOptions): Connector {
  const http = new ProviderHttp({
    baseUrl: OPENROUTER_BASE_URL,
    headers: { authorization: `Bearer ${options.secret}` },
    fetch: options.fetch,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });

  return {
    provider: 'openrouter',
    capabilities: { createKey: true, setLimit: true, revoke: true, usage: 'key_totals', tier: 'T1' },

    async test() {
      const current = parse(currentKeySchema, await http.json('GET', '/key'), 'key');
      if (current.data.is_management_key !== true && current.data.is_provisioning_key !== true) {
        throw new ConnectorError(
          'forbidden',
          'this is a regular OpenRouter key; paste a management (provisioning) key',
        );
      }
      const keys = await this.listKeys();
      const fingerprint =
        current.data.organization_id ?? current.data.creator_user_id ?? current.data.label ?? 'openrouter';
      return { fingerprint, details: { keys: keys.length } };
    },

    async listKeys() {
      const keys: ExternalKey[] = [];
      for (let offset = 0; offset < 10_000;) {
        const query = new URLSearchParams({ include_disabled: 'true', offset: String(offset) });
        const page = parse(listSchema, await http.json('GET', '/keys', undefined, query), 'keys');
        keys.push(...page.data.map(toKey));
        if (page.data.length === 0) break;
        offset += page.data.length;
      }
      return keys;
    },

    async createKey(name, limit): Promise<CreatedKey> {
      const body = { name, limit: limit === null ? null : microsToDollars(limit), limit_reset: null };
      const created = parse(createSchema, await http.json('POST', '/keys', body), 'create key');
      return { key: toKey(created.data), secret: created.key };
    },

    async setLimit(externalId, limit) {
      await http.json('PATCH', `/keys/${encodeURIComponent(externalId)}`, {
        limit: limit === null ? null : microsToDollars(limit),
      });
    },

    async revoke(externalId) {
      await http.json('PATCH', `/keys/${encodeURIComponent(externalId)}`, { disabled: true });
    },
  };
}
