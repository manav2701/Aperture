import createClient from 'openapi-fetch';
import type { paths } from './schema';

/** Same-origin calls; next.config.ts proxies /api/* to the control-plane API. */
export const api = createClient<paths>({ baseUrl: '' });

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

/** A message a person can act on, from an API error body (or a generic fallback). */
export function errorMessage(error: unknown): string {
  const message = (error as ApiErrorBody | undefined)?.error?.message;
  return message ?? 'Something went wrong. Please try again.';
}
