import {
  ANTHROPIC_BASE_URL,
  GEMINI_BASE_URL,
  HUGGINGFACE_ROUTER_URL,
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
  type Provider,
} from '@aperture/connectors';
import type { TextUsage } from '@aperture/core';

/*
 * One adapter per upstream wire format. The gateway is a passthrough: it only reads what it
 * needs (model, output cap, streaming flag, usage) and adds nothing but an output-token cap and
 * the stream-usage option. Upstream URLs are fixed here — never taken from the request.
 */

export type Json = Record<string, unknown>;

export interface UsageReport {
  usage: TextUsage;
  /** Exact cost in µUSD when the upstream reports it (OpenRouter `usage.cost`). */
  exactCost?: bigint;
  /** Upstream id to reconcile later (OpenRouter generation id). */
  generationId?: string;
}

export interface Adapter {
  format: 'openai' | 'anthropic' | 'gemini';
  provider: Provider;
  /** Model id as the upstream and the price catalog know it. */
  model: string;
  stream: boolean;
  /** Output tokens the request may produce, after applying the cap. */
  maxOutputTokens: bigint;
  /** Request body to forward, with the output cap and stream-usage option applied. */
  body: Json;
  url: string;
  headers(key: string): Record<string, string>;
  /** Usage from a non-streaming JSON response. */
  usageFromJson(response: unknown): UsageReport | undefined;
  /** Usage from one parsed SSE `data:` payload; the last non-undefined report wins. */
  usageFromEvent(event: unknown): UsageReport | undefined;
}

/** Applied when a request sets no output cap, so every reservation is bounded (G1). */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096n;

const num = (value: unknown): bigint =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : 0n;
const obj = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};

function capOutput(requested: unknown, cap: bigint | undefined): bigint {
  const asked = num(requested);
  const base = asked > 0n ? asked : DEFAULT_MAX_OUTPUT_TOKENS;
  return cap !== undefined && cap < base ? cap : base;
}

/** OpenAI-style usage (chat completions, embeddings, responses), with OpenRouter's exact cost. */
function openAiUsage(value: unknown): UsageReport | undefined {
  const usage = obj(obj(value).usage);
  if (Object.keys(usage).length === 0) return undefined;
  const prompt = num(usage.prompt_tokens) + num(usage.input_tokens);
  const cached =
    num(obj(usage.prompt_tokens_details).cached_tokens) + num(obj(usage.input_tokens_details).cached_tokens);
  const output = num(usage.completion_tokens) + num(usage.output_tokens);
  const report: UsageReport = {
    usage: { inputTokens: prompt > cached ? prompt - cached : 0n, outputTokens: output, cacheReadTokens: cached },
  };
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0) {
    report.exactCost = BigInt(Math.round(usage.cost * 1_000_000));
  }
  const id = obj(value).id;
  if (typeof id === 'string') report.generationId = id;
  return report;
}

export type OpenAiRoute = 'chat' | 'embeddings' | 'responses';

/** OpenAI-compatible routes, forwarded to OpenRouter, OpenAI or the Hugging Face router. */
export function openAiAdapter(input: {
  provider: 'openrouter' | 'openai' | 'huggingface';
  route: OpenAiRoute;
  body: Json;
  model: string;
  cap: bigint | undefined;
}): Adapter {
  const { route } = input;
  const stream = input.body.stream === true && route !== 'embeddings';
  const body: Json = { ...input.body, model: input.model };
  let maxOutputTokens = 0n;
  if (route === 'chat') {
    maxOutputTokens = capOutput(input.body.max_completion_tokens ?? input.body.max_tokens, input.cap);
    if ('max_completion_tokens' in input.body || input.provider === 'openai') {
      body.max_completion_tokens = Number(maxOutputTokens);
      delete body.max_tokens;
    } else {
      body.max_tokens = Number(maxOutputTokens);
    }
    if (stream) body.stream_options = { ...obj(input.body.stream_options), include_usage: true };
  }
  if (route === 'responses') {
    maxOutputTokens = capOutput(input.body.max_output_tokens, input.cap);
    body.max_output_tokens = Number(maxOutputTokens);
  }

  const base =
    input.provider === 'openrouter'
      ? OPENROUTER_BASE_URL
      : input.provider === 'openai'
        ? OPENAI_BASE_URL
        : `${HUGGINGFACE_ROUTER_URL}/v1`;
  const path = route === 'chat' ? '/chat/completions' : route === 'embeddings' ? '/embeddings' : '/responses';

  return {
    format: 'openai',
    provider: input.provider,
    model: input.model,
    stream,
    maxOutputTokens,
    body,
    url: `${base}${path}`,
    headers: (key) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' }),
    usageFromJson: openAiUsage,
    usageFromEvent(event) {
      // Responses API streams the final usage inside `response.completed`.
      const record = obj(event);
      if (record.type === 'response.completed') return openAiUsage(record.response);
      return openAiUsage(event);
    },
  };
}

/** Anthropic Messages API. */
export function anthropicAdapter(input: { body: Json; cap: bigint | undefined }): Adapter {
  const model = typeof input.body.model === 'string' ? input.body.model : '';
  const maxOutputTokens = capOutput(input.body.max_tokens, input.cap);
  let inputTokens = 0n;
  let cacheRead = 0n;
  let cacheWrite = 0n;
  const fromUsage = (usage: Json, output: bigint): UsageReport => {
    inputTokens = num(usage.input_tokens) || inputTokens;
    cacheRead = num(usage.cache_read_input_tokens) || cacheRead;
    cacheWrite = num(usage.cache_creation_input_tokens) || cacheWrite;
    return { usage: { inputTokens, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite } };
  };
  return {
    format: 'anthropic',
    provider: 'anthropic',
    model,
    stream: input.body.stream === true,
    maxOutputTokens,
    body: { ...input.body, max_tokens: Number(maxOutputTokens) },
    url: `${ANTHROPIC_BASE_URL}/messages`,
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }),
    usageFromJson(response) {
      const usage = obj(obj(response).usage);
      return Object.keys(usage).length === 0 ? undefined : fromUsage(usage, num(usage.output_tokens));
    },
    usageFromEvent(event) {
      const record = obj(event);
      // message_start carries input tokens; message_delta carries the running output count.
      if (record.type === 'message_start') {
        fromUsage(obj(obj(record.message).usage), 0n);
        return undefined;
      }
      if (record.type === 'message_delta') return fromUsage(obj(record.usage), num(obj(record.usage).output_tokens));
      return undefined;
    },
  };
}

/** Gemini generateContent / streamGenerateContent. */
export function geminiAdapter(input: { model: string; stream: boolean; body: Json; cap: bigint | undefined }): Adapter {
  const config = obj(input.body.generationConfig);
  const maxOutputTokens = capOutput(config.maxOutputTokens, input.cap);
  const usage = (value: unknown): UsageReport | undefined => {
    const meta = obj(obj(value).usageMetadata);
    if (Object.keys(meta).length === 0) return undefined;
    const prompt = num(meta.promptTokenCount);
    const cached = num(meta.cachedContentTokenCount);
    return {
      usage: {
        inputTokens: prompt > cached ? prompt - cached : 0n,
        // Thinking tokens are billed as output.
        outputTokens: num(meta.candidatesTokenCount) + num(meta.thoughtsTokenCount),
        cacheReadTokens: cached,
      },
    };
  };
  const method = input.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  return {
    format: 'gemini',
    provider: 'google',
    model: input.model,
    stream: input.stream,
    maxOutputTokens,
    body: { ...input.body, generationConfig: { ...config, maxOutputTokens: Number(maxOutputTokens) } },
    url: `${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(input.model)}:${method}`,
    headers: (key) => ({ 'x-goog-api-key': key, 'content-type': 'application/json' }),
    usageFromJson: usage,
    usageFromEvent: usage,
  };
}
