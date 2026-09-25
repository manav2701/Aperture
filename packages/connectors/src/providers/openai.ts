import { z } from 'zod';
import { ConnectorError, ProviderHttp } from '../http';
import type { Connector, ConnectorOptions, ExternalKey, UsageRecord } from '../types';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

const projectsSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string(), status: z.string().optional() })),
});
const keysSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullish(),
      redacted_value: z.string().nullish(),
    }),
  ),
  has_more: z.boolean(),
  last_id: z.string().nullish(),
});
const serviceAccountSchema = z.object({
  id: z.string(),
  api_key: z.object({ id: z.string(), value: z.string().min(1), name: z.string().nullish() }),
});
const usageSchema = z.object({
  data: z.array(
    z.object({
      start_time: z.number(),
      end_time: z.number(),
      result: z.array(
        z.object({
          input_tokens: z.number().int().min(0),
          input_cached_tokens: z.number().int().min(0).nullish(),
          output_tokens: z.number().int().min(0),
          api_key_id: z.string().nullish(),
          model: z.string().nullish(),
        }),
      ),
    }),
  ),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConnectorError('invalid_response', `unexpected OpenAI ${what} response`);
  return result.data;
}

/**
 * OpenAI with an organization Admin key. Aperture creates a service account per principal in
 * the configured project (the API returns its key once), imports per-minute usage by key and
 * model, and deletes a principal's key when a hard budget is breached (T2).
 */
export function openAiConnector(options: ConnectorOptions): Connector {
  const http = new ProviderHttp({
    baseUrl: OPENAI_BASE_URL,
    headers: { authorization: `Bearer ${options.secret}` },
    fetch: options.fetch,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  const projectId = typeof options.config.projectId === 'string' ? options.config.projectId : undefined;
  const requireProject = () => {
    if (projectId === undefined)
      throw new ConnectorError('bad_request', 'choose an OpenAI project for this connection');
    return encodeURIComponent(projectId);
  };

  return {
    provider: 'openai',
    capabilities: { createKey: true, setLimit: false, revoke: true, usage: 'buckets', tier: 'T2' },

    async test() {
      const projects = parse(
        projectsSchema,
        await http.json('GET', '/organization/projects', undefined, new URLSearchParams({ limit: '100' })),
        'projects',
      );
      const first = projects.data[0];
      // Admin keys are organization-scoped; the first project's id prefix is stable per org.
      return { fingerprint: projectId ?? first?.id ?? 'openai', details: { projects: projects.data.length } };
    },

    async listKeys() {
      const keys: ExternalKey[] = [];
      let after: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const query = new URLSearchParams({ limit: '100', ...(after === undefined ? {} : { after }) });
        const result = parse(
          keysSchema,
          await http.json('GET', `/organization/projects/${requireProject()}/api_keys`, undefined, query),
          'api keys',
        );
        keys.push(
          ...result.data.map((key) => ({
            externalId: key.id,
            name: key.name ?? key.id,
            hint: key.redacted_value ?? null,
            disabled: false,
          })),
        );
        if (!result.has_more || result.last_id == null) break;
        after = result.last_id;
      }
      return keys;
    },

    async createKey(name) {
      const created = parse(
        serviceAccountSchema,
        await http.json('POST', `/organization/projects/${requireProject()}/service_accounts`, { name }),
        'service account',
      );
      return {
        key: { externalId: created.api_key.id, name, hint: `${created.api_key.value.slice(0, 8)}…`, disabled: false },
        secret: created.api_key.value,
      };
    },

    async revoke(externalId) {
      await http.json(
        'DELETE',
        `/organization/projects/${requireProject()}/api_keys/${encodeURIComponent(externalId)}`,
      );
    },

    async usageSince(since) {
      const records: UsageRecord[] = [];
      let page: string | undefined;
      for (let i = 0; i < 100; i += 1) {
        const query = new URLSearchParams({
          start_time: String(Math.floor(since.getTime() / 1000)),
          bucket_width: '1m',
          limit: '1440',
          ...(projectId === undefined ? {} : { project_ids: projectId }),
          ...(page === undefined ? {} : { page }),
        });
        query.append('group_by', 'api_key_id');
        query.append('group_by', 'model');
        const result = parse(
          usageSchema,
          await http.json('GET', '/organization/usage/completions', undefined, query),
          'usage',
        );
        for (const bucket of result.data) {
          for (const row of bucket.result) {
            if (row.api_key_id == null) continue;
            const cached = BigInt(row.input_cached_tokens ?? 0);
            const input = BigInt(row.input_tokens);
            records.push({
              externalKeyId: row.api_key_id,
              model: row.model ?? 'unknown',
              bucketStart: new Date(bucket.start_time * 1000),
              bucketEnd: new Date(bucket.end_time * 1000),
              // OpenAI's input_tokens include cached tokens.
              inputTokens: input > cached ? input - cached : 0n,
              outputTokens: BigInt(row.output_tokens),
              cacheReadTokens: cached,
              cacheWriteTokens: 0n,
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
