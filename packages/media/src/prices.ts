import { OPENROUTER_BASE_URL, decimalToScaled, type FetchLike } from '@aperture/connectors';
import { z } from 'zod';

/*
 * Media prices, all in µUSD. Built daily from OpenRouter's public image and video model lists;
 * direct OpenAI and Google (Veo) entries are derived from the same data, so no price is typed by
 * hand. Estimates are deliberately upper bounds; settlement uses the provider's actual cost.
 */

export type MediaProvider = 'openrouter' | 'openai' | 'google';
export type MediaKind = 'image' | 'video';

export interface MediaPrice {
  provider: MediaProvider;
  model: string;
  kind: MediaKind;
  /** µUSD per image, when priced per image. */
  perImage: bigint | null;
  /** µUSD per million output image tokens, when priced per token. */
  perImageTokenPerM: bigint | null;
  /** µUSD per second of video: the highest per-second rate the model has (upper bound). */
  perSecond: bigint | null;
  /** The provider's own SKU table, kept for resolution/audio-specific rates and display. */
  skus: Record<string, string>;
  source: string;
}

const videoModelsSchema = z.object({
  data: z.array(z.object({ id: z.string(), pricing_skus: z.record(z.string(), z.string()).nullish() })),
});
const imageModelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const imageEndpointsSchema = z.object({
  endpoints: z.array(
    z.object({
      pricing: z
        .array(z.object({ billable: z.string(), unit: z.string(), cost_usd: z.number().nonnegative() }))
        .nullish(),
    }),
  ),
});

const usdToMicros = (dollars: string) => decimalToScaled(dollars, 6);
const centsToMicros = (cents: string) => decimalToScaled(cents, 4);

/** µUSD per second for one SKU key, or null when the SKU isn't a per-second rate. */
function perSecondOf(key: string, value: string): bigint | null {
  if (/minimum|image|megapixel|reference|token/.test(key)) return null;
  if (key.startsWith('cents_per') && key.includes('second')) return centsToMicros(value);
  if (key.startsWith('duration_seconds') || key.includes('_duration_seconds')) return usdToMicros(value);
  return null;
}

/**
 * The per-second rate for a request: the highest SKU that matches the resolution and audio
 * choice, else the highest of all. Never lower than what the provider could charge.
 */
export function videoRate(
  price: MediaPrice,
  request: { resolution?: string | undefined; audio?: boolean | undefined },
): bigint | null {
  const rates = Object.entries(price.skus)
    .map(([key, value]) => ({ key, rate: perSecondOf(key, value) }))
    .filter((entry): entry is { key: string; rate: bigint } => entry.rate !== null);
  if (rates.length === 0) return price.perSecond;
  const resolution = request.resolution?.toLowerCase();
  const audioFits = (key: string) =>
    !(request.audio === false && key.includes('with_audio')) &&
    !(request.audio === true && key.includes('without_audio'));
  const mentionsResolution = (key: string) => /\d+p|[124]k/i.test(key);
  // Prefer SKUs naming the requested resolution; fall back to resolution-free ones, then to all.
  const specific = rates.filter(
    ({ key }) => resolution !== undefined && key.toLowerCase().includes(resolution) && audioFits(key),
  );
  const generic = rates.filter(({ key }) => !mentionsResolution(key) && audioFits(key));
  const pool = specific.length > 0 ? specific : generic.length > 0 ? generic : rates;
  return pool.reduce((max, { rate }) => (rate > max ? rate : max), 0n);
}

/**
 * Output tokens one image can take, as an upper bound. Gemini image models use about 1,120–1,290
 * tokens up to 2K and about 2,000 at 4K; OpenAI's gpt-image models use 272 (low), 1,056 (medium)
 * or 4,160 (high) at 1024², more for larger sizes.
 */
export function imageTokensUpperBound(
  model: string,
  options: { quality?: string | undefined; resolution?: string | undefined },
): bigint {
  const id = model.toLowerCase();
  if (id.includes('gemini')) return options.resolution?.toUpperCase() === '4K' ? 2_600n : 1_400n;
  if (options.quality === 'low') return 400n;
  if (options.quality === 'medium') return 1_600n;
  return 6_300n;
}

/** Upper-bound cost of `count` images (µUSD); null when the model has no image price. */
export function estimateImages(
  price: MediaPrice,
  request: { count: number; quality?: string | undefined; resolution?: string | undefined },
): bigint | null {
  const count = BigInt(request.count);
  if (price.perImage !== null) return price.perImage * count;
  if (price.perImageTokenPerM === null) return null;
  const tokens = imageTokensUpperBound(price.model, request) * count;
  const micros = (tokens * price.perImageTokenPerM + 999_999n) / 1_000_000n;
  return micros > 0n ? micros : 1n;
}

/** Upper-bound cost of a video (µUSD); null when the model has no per-second price. */
export function estimateVideo(
  price: MediaPrice,
  request: { seconds: number; resolution?: string | undefined; audio?: boolean | undefined },
): bigint | null {
  const rate = videoRate(price, request);
  return rate === null ? null : rate * BigInt(request.seconds);
}

/** Direct-provider model ids for OpenRouter's vendor/model ids. */
const VEO_DIRECT: Record<string, string> = {
  'google/veo-3.1-lite': 'veo-3.1-lite-generate-preview',
  'google/veo-3.1-fast': 'veo-3.1-fast-generate-preview',
  'google/veo-3.1': 'veo-3.1-generate-preview',
};

async function getJson(fetchImpl: FetchLike, path: string): Promise<unknown> {
  const response = await fetchImpl(`${OPENROUTER_BASE_URL}${path}`, {
    method: 'GET',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`OpenRouter ${path} answered ${String(response.status)}`);
  return response.json();
}

export async function fetchMediaCatalog(options: { fetch?: FetchLike } = {}): Promise<MediaPrice[]> {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const prices: MediaPrice[] = [];

  const videos = videoModelsSchema.parse(await getJson(fetchImpl, '/videos/models'));
  for (const model of videos.data) {
    const skus = model.pricing_skus ?? {};
    const rates = Object.entries(skus)
      .map(([key, value]) => perSecondOf(key, value))
      .filter((rate): rate is bigint => rate !== null);
    const perSecond = rates.length === 0 ? null : rates.reduce((max, rate) => (rate > max ? rate : max), 0n);
    const entry = {
      kind: 'video' as const,
      perImage: null,
      perImageTokenPerM: null,
      perSecond,
      skus,
      source: 'openrouter-api',
    };
    prices.push({ provider: 'openrouter', model: model.id, ...entry });
    const direct = VEO_DIRECT[model.id];
    if (direct !== undefined) prices.push({ provider: 'google', model: direct, ...entry });
  }

  const images = imageModelsSchema.parse(await getJson(fetchImpl, '/images/models'));
  for (const model of images.data) {
    let endpoints: z.infer<typeof imageEndpointsSchema>;
    try {
      endpoints = imageEndpointsSchema.parse(await getJson(fetchImpl, `/images/models/${model.id}/endpoints`));
    } catch {
      continue; // One broken model must not stop the catalog.
    }
    // Across providers serving the model, keep the highest rate (upper bound).
    let perImage: bigint | null = null;
    let perImageTokenPerM: bigint | null = null;
    for (const item of endpoints.endpoints.flatMap((endpoint) => endpoint.pricing ?? [])) {
      if (item.billable !== 'output_image') continue;
      const value = decimalToScaled(item.cost_usd.toFixed(12), item.unit === 'token' ? 12 : 6);
      if (value === null) continue;
      if (item.unit === 'image' && (perImage === null || value > perImage)) perImage = value;
      if (item.unit === 'token' && (perImageTokenPerM === null || value > perImageTokenPerM)) perImageTokenPerM = value;
    }
    if (perImage === null && perImageTokenPerM === null) continue;
    const entry = {
      kind: 'image' as const,
      perImage,
      perImageTokenPerM,
      perSecond: null,
      skus: {},
      source: 'openrouter-api',
    };
    prices.push({ provider: 'openrouter', model: model.id, ...entry });
    if (model.id.startsWith('openai/'))
      prices.push({ provider: 'openai', model: model.id.slice('openai/'.length), ...entry });
  }
  return prices;
}
