import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import createClient from 'openapi-fetch';
import type { paths } from './schema';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** The API as the signed-in user, for server components (reads only; writes go through the browser). */
export async function serverApi() {
  const cookie = (await cookies()).toString();
  return createClient<paths>({ baseUrl: apiUrl, headers: { cookie }, cache: 'no-store' });
}

/**
 * The data of a successful call. Not signed in → the login page; unknown or forbidden
 * resources → the not-found page (the API already answers 404 for other orgs).
 */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data;
  const status = result.response.status;
  if (status === 401) redirect('/login');
  if (status === 403 || status === 404) notFound();
  throw new Error(`API request failed with ${String(status)}`);
}
