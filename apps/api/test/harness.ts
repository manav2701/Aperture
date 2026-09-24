import { connect, type DatabaseHandle } from '@aperture/db';
import { appRoleUrl, createTestDatabase } from '@aperture/db/testing';
import { createLogger } from '@aperture/runtime';
import { buildApp } from '../src/app';
import { createAuth } from '../src/auth';
import type { Email, EmailSender } from '../src/email';

const WEB_ORIGIN = 'http://localhost:3000';

/** Captures emails so tests can follow verification and invitation links. */
class Outbox implements EmailSender {
  readonly sent: Email[] = [];

  send(email: Email): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }

  /** The first link in the most recent email to `to`. */
  linkFor(to: string): string {
    const email = [...this.sent].reverse().find((e) => e.to === to);
    const link = email?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error(`no email with a link was sent to ${to}`);
    return link;
  }
}

export interface Harness {
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  outbox: Outbox;
  system: DatabaseHandle;
  routes: ReturnType<typeof buildApp>['routes'];
  close: () => Promise<void>;
}

/** The API wired to a fresh database, connecting as the non-superuser app role like production. */
export async function createHarness(): Promise<Harness> {
  const system = await createTestDatabase();
  const appDb = connect(appRoleUrl(system.url));
  const outbox = new Outbox();
  const logger = createLogger({ service: 'api-test', level: 'silent' });
  const auth = createAuth({
    db: appDb.db,
    email: outbox,
    env: {
      NODE_ENV: 'test',
      WEB_ORIGIN,
      BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-thirty-two-chars',
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    },
  });
  const { app, routes } = buildApp({ db: appDb.db, auth, email: outbox, logger, webOrigin: WEB_ORIGIN });

  const request = async (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('origin')) headers.set('origin', WEB_ORIGIN);
    if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (init.cookie !== undefined) headers.set('cookie', init.cookie);
    return await app.request(`${WEB_ORIGIN}${path}`, { ...init, headers });
  };

  return {
    request,
    outbox,
    system,
    routes,
    close: async () => {
      await appDb.close();
      await system.close();
    },
  };
}

/** Signs up with email and password, follows the verification link, and returns the session cookie. */
export async function signUp(harness: Harness, email: string, name = email.split('@')[0] ?? 'user'): Promise<string> {
  const response = await harness.request('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'correct horse battery staple', name }),
  });
  if (!response.ok) throw new Error(`sign-up failed: ${String(response.status)} ${await response.text()}`);
  const link = new URL(harness.outbox.linkFor(email));
  const verified = await harness.request(`${link.pathname}${link.search}`, { redirect: 'manual' });
  const cookie = verified.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie.includes('session_token')) throw new Error(`verification did not sign in: ${String(verified.status)}`);
  return cookie;
}

export async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function createOrg(harness: Harness, cookie: string, name = 'Acme'): Promise<string> {
  const response = await harness.request('/api/v1/orgs', { method: 'POST', cookie, body: JSON.stringify({ name }) });
  if (response.status !== 201) throw new Error(`create org failed: ${String(response.status)}`);
  return (await body<{ id: string }>(response)).id;
}

/** Invites `email` into the org with `role`, signs them up, accepts, and returns their cookie. */
export async function joinAs(
  harness: Harness,
  input: { ownerCookie: string; orgId: string; email: string; role: string; teamId?: string },
): Promise<string> {
  const invited = await harness.request(`/api/v1/orgs/${input.orgId}/invitations`, {
    method: 'POST',
    cookie: input.ownerCookie,
    body: JSON.stringify({ email: input.email, role: input.role, teamId: input.teamId ?? null }),
  });
  if (invited.status !== 201) throw new Error(`invite failed: ${String(invited.status)} ${await invited.text()}`);
  const token = invitationToken(harness, input.email);
  const cookie = await signUp(harness, input.email);
  const accepted = await harness.request('/api/v1/invitations/accept', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ token }),
  });
  if (accepted.status !== 200) throw new Error(`accept failed: ${String(accepted.status)} ${await accepted.text()}`);
  return cookie;
}

/** The token from the most recent invitation email sent to `email`. */
export function invitationToken(harness: Harness, email: string): string {
  const invitation = [...harness.outbox.sent]
    .reverse()
    .find((e) => e.to === email && e.subject.includes('invited you'));
  const token = invitation?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
  if (token === undefined) throw new Error(`no invitation was sent to ${email}`);
  return token;
}
