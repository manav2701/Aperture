import { z } from 'zod';
import { ConnectorError, ProviderHttp } from '../http';
import type { Connector, ConnectorOptions, ExternalKey, UsageRecord } from '../types';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

const workspacesSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const orgSchema = z.object({ id: z.string() });
const keysSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      partial_key_hint: z.string().nullish(),
    }),
  ),
  has_more: z.boolean(),
  last_id: z.string().nullish(),
});
const usageSchema = z.object({
  data: z.array(
    z.object({
      starting_at: z.string(),
      ending_at: z.string(),
      results: z.array(
        z.object({
          api_key_id: z.string().nullish(),
          model: z.string().nullish(),
          uncached_input_tokens: z.number().int().min(0),
          cache_read_input_tokens: z.number().int().min(0).nullish(),
          cache_creation: z
            .object({
              ephemeral_1h_input_tokens: z.number().int().min(0).nullish(),
              ephemeral_5m_input_tokens: z.number().int().min(0).nullish(),
            })
            .nullish(),
          output_tokens: z.number().int().min(0),
        }),
      ),
    }),
  ),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConnectorError('invalid_response', `unexpected Anthropic ${what} response`);
  return result.data;
}

/**
 * Anthropic with an organization Admin key. Keys can't be created through the API, so the
 * customer's existing keys are imported and mapped to principals; on a hard-budget breach the
 * key is set to `inactive` (T2).
 */
export function anthropicConnector(options: ConnectorOptions): Connector {
  const http = new ProviderHttp({
    baseUrl: ANTHROPIC_BASE_URL,
    headers: { 'x-api-key': options.secret, 'anthropic-version': '2023-06-01' },
    fetch: options.fetch,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });

  return {
    provider: 'anthropic',
    capabilities: { createKey: false, setLimit: false, revoke: true, usage: 'buckets', tier: 'T2' },

    async test() {
      const org = parse(orgSchema, await http.json('GET', '/organizations/me'), 'organization');
      const workspaces = parse(workspacesSchema, await http.json('GET', '/organizations/workspaces'), 'workspaces');
      return { fingerprint: org.id, details: { workspaces: workspaces.data.length } };
    },

    async listKeys() {
      const keys: ExternalKey[] = [];
      let after: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const query = new URLSearchParams({ limit: '1000', ...(after === undefined ? {} : { after_id: after }) });
        const result = parse(
          keysSchema,
          await http.json('GET', '/organizations/api_keys', undefined, query),
          'api keys',
        );
        keys.push(
          ...result.data.map((key) => ({
            externalId: key.id,
            name: key.name,
            hint: key.partial_key_hint ?? null,
            disabled: key.status !== 'active',
          })),
        );
        if (!result.has_more || result.last_id == null) break;
        after = result.last_id;
      }
      return keys;
    },

    async revoke(externalId) {
      await http.json('POST', `/organizations/api_keys/${encodeURIComponent(externalId)}`, { status: 'inactive' });
    },

    async usageSince(since) {
      const records: UsageRecord[] = [];
      let page: string | undefined;
      for (let i = 0; i < 100; i += 1) {
        const query = new URLSearchParams({
          starting_at: since.toISOString(),
          bucket_width: '1m',
          limit: '1440',
          ...(page === undefined ? {} : { page }),
        });
        query.append('group_by[]', 'api_key_id');
        query.append('group_by[]', 'model');
        const result = parse(
          usageSchema,
          await http.json('GET', '/organizations/usage_report/messages', undefined, query),
          'usage',
        );
        for (const bucket of result.data) {
          for (const row of bucket.results) {
            if (row.api_key_id == null) continue;
            records.push({
              externalKeyId: row.api_key_id,
              model: row.model ?? 'unknown',
              bucketStart: new Date(bucket.starting_at),
              bucketEnd: new Date(bucket.ending_at),
              inputTokens: BigInt(row.uncached_input_tokens),
              outputTokens: BigInt(row.output_tokens),
              cacheReadTokens: BigInt(row.cache_read_input_tokens ?? 0),
              cacheWriteTokens: BigInt(
                (row.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
                  (row.cache_creation?.ephemeral_5m_input_tokens ?? 0),
              ),
            });
          }
        }
        if (!result.has_more || result.next_page == null) break;
        page = result.next_page;
      }
      return records;
    },
  };
}
