import { GEMINI_BASE_URL, OPENAI_BASE_URL, OPENROUTER_BASE_URL, type FetchLike } from '@aperture/connectors';
import { z } from 'zod';
import type { MediaProvider } from './prices';

/*
 * Upstream media APIs. Every URL is fixed here or validated against a fixed host; bytes come
 * back to Aperture, which stores them privately (G14) — provider URLs are never shown to people.
 */

export class MediaProviderError extends Error {
  readonly status: number;
  /** The provider said the request itself is bad (4xx): nothing was generated. */
  readonly clientError: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MediaProviderError';
    this.status = status;
    this.clientError = status >= 400 && status < 500;
  }
}

export interface GeneratedFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface ImageRequest {
  model: string;
  prompt: string;
  count: number;
  size?: string | undefined;
  quality?: string | undefined;
  resolution?: string | undefined;
  aspectRatio?: string | undefined;
}

export interface ImageResult {
  files: GeneratedFile[];
  /** Exact cost when the provider reports it (µUSD). */
  exactCost?: bigint;
  /** Output image tokens, for token-priced models without a reported cost. */
  outputTokens?: bigint;
}

export interface VideoRequest {
  model: string;
  prompt: string;
  seconds: number;
  resolution?: string | undefined;
  aspectRatio?: string | undefined;
  audio?: boolean | undefined;
}

export type VideoStatus =
  | { state: 'running' }
  | { state: 'succeeded'; exactCost?: bigint; outputs: string[] }
  | { state: 'failed'; reason: string; exactCost?: bigint };

/** Whether a provider charges for failed generations (G13). Conservative (true) unless verified. */
export const BILLS_ON_FAILURE: Record<MediaProvider, boolean> = {
  // OpenRouter reports `usage.cost` on failed jobs when there is a charge; none means none.
  openrouter: false,
  // Veo on the Gemini API bills generated seconds; a failed operation produces none.
  google: false,
  openai: true,
};

const fetcher = (fetchImpl?: FetchLike): FetchLike => fetchImpl ?? ((input, init) => fetch(input, init));

async function call(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs = 120_000): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new MediaProviderError(`provider unreachable: ${(error as Error).message}`, 502);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new MediaProviderError(`provider answered ${String(response.status)} ${detail}`.trim(), response.status);
  }
  return response;
}

const dollars = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? BigInt(Math.round(value * 1_000_000)) : undefined;

function decode(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

// ---------------------------------------------------------------------------------------------
// OpenRouter

const orImagesSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1), media_type: z.string().optional() })),
  usage: z
    .object({
      cost: z.number().nullish(),
      completion_tokens_details: z.object({ image_tokens: z.number().nullish() }).nullish(),
    })
    .nullish(),
});
const orVideoSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'expired']),
  error: z.string().nullish(),
  unsigned_urls: z.array(z.string()).nullish(),
  usage: z.object({ cost: z.number().nullish() }).nullish(),
});

export function openRouterMedia(key: string, fetchImpl?: FetchLike) {
  const f = fetcher(fetchImpl);
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  return {
    async generateImages(request: ImageRequest): Promise<ImageResult> {
      const response = await call(f, `${OPENROUTER_BASE_URL}/images`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          n: request.count,
          ...(request.size === undefined ? {} : { size: request.size }),
          ...(request.quality === undefined ? {} : { quality: request.quality }),
          ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
          ...(request.aspectRatio === undefined ? {} : { aspect_ratio: request.aspectRatio }),
        }),
      });
      const parsed = orImagesSchema.parse(await response.json());
      const result: ImageResult = {
        files: parsed.data.map((item) => ({
          bytes: decode(item.b64_json),
          contentType: item.media_type ?? 'image/png',
        })),
      };
      const cost = dollars(parsed.usage?.cost);
      if (cost !== undefined) result.exactCost = cost;
      const tokens = parsed.usage?.completion_tokens_details?.image_tokens;
      if (typeof tokens === 'number') result.outputTokens = BigInt(tokens);
      return result;
    },

    async submitVideo(request: VideoRequest): Promise<string> {
      const response = await call(f, `${OPENROUTER_BASE_URL}/videos`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          duration: request.seconds,
          ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
          ...(request.aspectRatio === undefined ? {} : { aspect_ratio: request.aspectRatio }),
          ...(request.audio === undefined ? {} : { generate_audio: request.audio }),
        }),
      });
      return orVideoSchema.parse(await response.json()).id;
    },

    async pollVideo(jobId: string): Promise<VideoStatus> {
      const response = await call(
        f,
        `${OPENROUTER_BASE_URL}/videos/${encodeURIComponent(jobId)}`,
        { method: 'GET', headers },
        30_000,
      );
      const job = orVideoSchema.parse(await response.json());
      const cost = dollars(job.usage?.cost);
      if (job.status === 'completed') {
        const count = Math.max(job.unsigned_urls?.length ?? 1, 1);
        return {
          state: 'succeeded',
          ...(cost === undefined ? {} : { exactCost: cost }),
          outputs: Array.from({ length: count }, (_, index) => String(index)),
        };
      }
      if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') {
        return { state: 'failed', reason: job.error ?? job.status, ...(cost === undefined ? {} : { exactCost: cost }) };
      }
      return { state: 'running' };
    },

    async downloadVideo(jobId: string, output: string): Promise<GeneratedFile> {
      const response = await call(
        f,
        `${OPENROUTER_BASE_URL}/videos/${encodeURIComponent(jobId)}/content?index=${encodeURIComponent(output)}`,
        { method: 'GET', headers: { authorization: `Bearer ${key}` } },
        300_000,
      );
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'video/mp4',
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// OpenAI images

const openAiImagesSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1) })),
  output_format: z.string().optional(),
  usage: z.object({ output_tokens: z.number().nullish() }).nullish(),
});

export function openAiMedia(key: string, fetchImpl?: FetchLike) {
  const f = fetcher(fetchImpl);
  return {
    async generateImages(request: ImageRequest): Promise<ImageResult> {
      const response = await call(f, `${OPENAI_BASE_URL}/images/generations`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          n: request.count,
          ...(request.size === undefined ? {} : { size: request.size }),
          ...(request.quality === undefined ? {} : { quality: request.quality }),
        }),
      });
      const parsed = openAiImagesSchema.parse(await response.json());
      const contentType = `image/${parsed.output_format === 'jpeg' ? 'jpeg' : (parsed.output_format ?? 'png')}`;
      const result: ImageResult = { files: parsed.data.map((item) => ({ bytes: decode(item.b64_json), contentType })) };
      if (typeof parsed.usage?.output_tokens === 'number') result.outputTokens = BigInt(parsed.usage.output_tokens);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Google Veo (Gemini API long-running operations)

const operationSchema = z.object({
  name: z.string().min(1),
  done: z.boolean().optional(),
  error: z.object({ message: z.string().optional() }).nullish(),
  response: z
    .object({
      generateVideoResponse: z
        .object({ generatedSamples: z.array(z.object({ video: z.object({ uri: z.string() }).nullish() })).nullish() })
        .nullish(),
    })
    .nullish(),
});

const GEMINI_HOST = new URL(GEMINI_BASE_URL).host;

export function googleMedia(key: string, fetchImpl?: FetchLike) {
  const f = fetcher(fetchImpl);
  const headers = { 'x-goog-api-key': key, 'content-type': 'application/json' };
  return {
    async submitVideo(request: VideoRequest): Promise<string> {
      const response = await call(
        f,
        `${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(request.model)}:predictLongRunning`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            instances: [{ prompt: request.prompt }],
            parameters: {
              durationSeconds: request.seconds,
              numberOfVideos: 1,
              ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
              ...(request.aspectRatio === undefined ? {} : { aspectRatio: request.aspectRatio }),
            },
          }),
        },
      );
      return operationSchema.parse(await response.json()).name;
    },

    async pollVideo(operationName: string): Promise<VideoStatus> {
      if (!/^models\/[\w.-]+\/operations\/[\w-]+$/.test(operationName))
        throw new MediaProviderError('unexpected operation name', 400);
      const response = await call(f, `${GEMINI_BASE_URL}/v1beta/${operationName}`, { method: 'GET', headers }, 30_000);
      const operation = operationSchema.parse(await response.json());
      if (operation.done !== true) return { state: 'running' };
      if (operation.error) return { state: 'failed', reason: operation.error.message ?? 'generation failed' };
      const uris = (operation.response?.generateVideoResponse?.generatedSamples ?? [])
        .map((sample) => sample.video?.uri)
        .filter((uri): uri is string => uri !== undefined);
      if (uris.length === 0) return { state: 'failed', reason: 'no video returned (possibly filtered)' };
      return { state: 'succeeded', outputs: uris };
    },

    async downloadVideo(_operationName: string, uri: string): Promise<GeneratedFile> {
      // Only ever send the API key to Google's own host.
      if (new URL(uri).host !== GEMINI_HOST)
        throw new MediaProviderError('video URI is not on the Gemini API host', 400);
      // The file may redirect to storage elsewhere: follow by hand so the key never goes there.
      let response = await f(uri, {
        method: 'GET',
        headers: { 'x-goog-api-key': key },
        redirect: 'manual',
        signal: AbortSignal.timeout(300_000),
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location !== null) {
        response = await call(f, new URL(location, uri).toString(), { method: 'GET' }, 300_000);
      } else if (!response.ok) {
        throw new MediaProviderError(`provider answered ${String(response.status)}`, response.status);
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'video/mp4',
      };
    },
  };
}
