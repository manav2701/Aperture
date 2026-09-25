import { z } from 'zod';
import { decimalToScaled } from './amounts';
import { ConnectorError, ProviderHttp, type FetchLike } from './http';
import { OPENROUTER_BASE_URL } from './providers/openrouter';
import type { Provider } from './types';

/** µUSD per million tokens. */
export interface ModelPrice {
  provider: Provider;
  model: string;
  inputPerMTok: bigint;
  outputPerMTok: bigint;
  cacheReadPerMTok: bigint | null;
  cacheWritePerMTok: bigint | null;
  source: string;
}

const modelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      pricing: z.object({
        prompt: z.string(),
        completion: z.string(),
        input_cache_read: z.string().optional(),
        input_cache_write: z.string().optional(),
      }),
    }),
  ),
});

/** Providers whose models OpenRouter lists under `<provider>/<model>` at the provider's own price. */
const DIRECT_PREFIXES: Partial<Record<string, Provider>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
};

/**
 * One canonical spelling per model, so `claude-sonnet-4-5-20250929` (Anthropic API),
 * `claude-sonnet-4.5` (OpenRouter) and `models/gemini-2.5-flash` (Gemini API) all find a price.
 */
export function normalizeModel(provider: Provider, model: string): string {
  let id = model.trim().toLowerCase();
  if (provider === 'openrouter') return id;
  id = id.replace(/^models\//, '').replace(/:.*$/, '');
  if (provider === 'anthropic') id = id.replaceAll('.', '-').replace(/-\d{8}$/, '');
  if (provider === 'openai') id = id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  return id;
}

/** Per-token dollar strings → µUSD per million tokens (× 10^12), rounded up. */
const perMTok = (value: string | undefined) => (value === undefined ? null : decimalToScaled(value, 12));

/**
 * Prices from OpenRouter's public model list. Direct-provider entries are derived from the same
 * list (OpenRouter passes provider list prices through), so no price is ever typed by hand.
 * Variable-priced routers ("-1") are skipped: an unpriced model is denied by the gateway (G6).
 */
export async function fetchPriceCatalog(options: { fetch?: FetchLike } = {}): Promise<ModelPrice[]> {
  const http = new ProviderHttp({ baseUrl: OPENROUTER_BASE_URL, headers: {}, fetch: options.fetch });
  const result = modelsSchema.safeParse(await http.json('GET', '/models'));
  if (!result.success) throw new ConnectorError('invalid_response', 'unexpected OpenRouter models response');

  const prices: ModelPrice[] = [];
  const seen = new Set<string>();
  for (const model of result.data.data) {
    const input = perMTok(model.pricing.prompt);
    const output = perMTok(model.pricing.completion);
    if (input === null || output === null) continue;
    const entry = {
      inputPerMTok: input,
      outputPerMTok: output,
      cacheReadPerMTok: perMTok(model.pricing.input_cache_read),
      cacheWritePerMTok: perMTok(model.pricing.input_cache_write),
      source: 'openrouter-api',
    };
    prices.push({ provider: 'openrouter', model: normalizeModel('openrouter', model.id), ...entry });

    const [prefix, ...rest] = model.id.split('/');
    const direct = prefix === undefined ? undefined : DIRECT_PREFIXES[prefix];
    if (direct !== undefined && rest.length > 0) {
      const name = normalizeModel(direct, rest.join('/'));
      const key = `${direct}:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        prices.push({ provider: direct, model: name, ...entry });
      }
    }
  }
  return prices;
}
