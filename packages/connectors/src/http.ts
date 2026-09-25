/**
 * The only way connectors reach providers. Base URLs are fixed per provider (never taken from
 * user input), every call has a timeout, and 429/5xx responses are retried with jittered
 * backoff that honours `Retry-After`.
 */

export type ConnectorErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'unsupported';

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly status: number | undefined;

  constructor(code: ConnectorErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.status = status;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  baseUrl: string;
  headers: Record<string, string>;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: FetchLike | undefined;
  timeoutMs?: number;
  maxRetries?: number;
  /** Called before retrying; tests pass a no-op so they don't wait. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function codeFor(status: number): ConnectorErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

/** Retry delay: `Retry-After` when the provider sends one (capped), else exponential with jitter. */
function retryDelay(response: Response | undefined, attempt: number): number {
  const header = response?.headers.get('retry-after');
  if (header !== null && header !== undefined) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  }
  const base = 250 * 2 ** attempt;
  return base / 2 + ((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % (base / 2));
}

export class ProviderHttp {
  private readonly options: Required<Omit<HttpOptions, 'fetch'>> & { fetch: FetchLike };

  constructor(options: HttpOptions) {
    this.options = {
      timeoutMs: 20_000,
      maxRetries: 3,
      sleep: defaultSleep,
      ...options,
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    };
  }

  /** Performs a request and parses JSON. `path` is appended to the fixed base URL. */
  async json(method: string, path: string, body?: unknown, query?: URLSearchParams): Promise<unknown> {
    const response = await this.send(method, path, body, query);
    const text = await response.text();
    if (text === '') return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ConnectorError('invalid_response', `provider returned non-JSON for ${method} ${path}`, response.status);
    }
  }

  private async send(method: string, path: string, body: unknown, query: URLSearchParams | undefined) {
    if (!path.startsWith('/') || path.includes('://')) throw new Error(`invalid provider path ${path}`);
    const url = `${this.options.baseUrl}${path}${query === undefined || query.size === 0 ? '' : `?${query.toString()}`}`;
    const init: RequestInit = {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...this.options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };

    let lastError: ConnectorError | undefined;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      let response: Response | undefined;
      try {
        response = await this.options.fetch(url, { ...init, signal: AbortSignal.timeout(this.options.timeoutMs) });
      } catch (error) {
        lastError = new ConnectorError('unavailable', `could not reach provider: ${(error as Error).message}`);
      }
      if (response?.ok === true) return response;
      if (response !== undefined) {
        const code = codeFor(response.status);
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        lastError = new ConnectorError(
          code,
          `provider answered ${String(response.status)} ${detail}`.trim(),
          response.status,
        );
        if (code !== 'rate_limited' && code !== 'unavailable') throw lastError;
      }
      if (attempt < this.options.maxRetries) await this.options.sleep(retryDelay(response, attempt));
    }
    throw lastError ?? new ConnectorError('unavailable', 'provider request failed');
  }
}
