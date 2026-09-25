import type { FetchLike } from '../src/http';

export interface RecordedCall {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/**
 * A scripted provider: routes are matched by "METHOD /path" (path relative to the host, query
 * ignored); every call is recorded so tests can assert what was sent.
 */
export function fakeProvider(routes: Record<string, Handler | Handler[]>) {
  const calls: RecordedCall[] = [];
  const queues = new Map(
    Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const raw = typeof init.body === 'string' ? init.body : undefined;
    let body: unknown = raw;
    if (raw !== undefined) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
    }
    const call = { method, url, headers: new Headers(init.headers), body };
    calls.push(call);
    const route = queues.get(`${method} ${url.pathname}`);
    if (route === undefined) return Response.json({ error: 'no fake route' }, { status: 404 });
    const handler = Array.isArray(route) ? (route.length > 1 ? route.shift() : route[0]) : route;
    if (handler === undefined) throw new Error('empty handler list');
    return await handler(call);
  };

  return { fetch, calls };
}

export const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    Response.json(body, { status, headers });

export const noSleep = () => Promise.resolve();
