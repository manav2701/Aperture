import { createHmac, timingSafeEqual } from 'node:crypto';
import { can, grantFor } from '@aperture/core';
import { decryptSecret, encryptSecret } from '@aperture/crypto';
import {
  MandateError,
  and,
  appendAuditEvent,
  decideApproval,
  eq,
  schema,
  sql,
  withOrg,
  withSystem,
} from '@aperture/db';
import { SLACK_API, slackApi, slackEscape } from '@aperture/jobs';
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from './http/access';
import type { AppDeps, AppEnv } from './http/context';
import { AppError } from './http/errors';
import { OrgParams, errorResponses, json } from './http/schemas';

/*
 * The Slack app (plan/phases/phase-07 §7.2, edge case A4): per-org OAuth install, and
 * interactive Approve / Deny. Every interaction is checked against Slack's signing secret with
 * a five-minute window, and the clicking Slack user must map — by an email both Slack and
 * Aperture have verified — to a member allowed to decide that approval. Separation of duties
 * applies exactly as in the dashboard.
 */

const SCOPES = 'chat:write,users:read,users:read.email,incoming-webhook';
const STATE_TTL_SECONDS = 600;
const TOLERANCE_SECONDS = 300;

const b64 = (value: string) => Buffer.from(value).toString('base64url');

function signState(secret: string, state: { orgId: string; userId: string; exp: number }): string {
  const body = b64(JSON.stringify(state));
  const mac = createHmac('sha256', secret).update(`slack-install.${body}`).digest('base64url');
  return `${body}.${mac}`;
}

function readState(secret: string, token: string): { orgId: string; userId: string } | undefined {
  const [body = '', mac = ''] = token.split('.');
  const expected = createHmac('sha256', secret).update(`slack-install.${body}`).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      orgId: string;
      userId: string;
      exp: number;
    };
    return state.exp > Date.now() / 1000 ? state : undefined;
  } catch {
    return undefined;
  }
}

/** Slack's request signature: v0=HMAC-SHA256(signing secret, "v0:{timestamp}:{raw body}"). */
export function verifySlackSignature(
  signingSecret: string,
  headers: { timestamp: string | null; signature: string | null },
  rawBody: string,
  now = Date.now(),
): boolean {
  const { timestamp, signature } = headers;
  if (timestamp === null || signature === null || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(
    `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`,
  );
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const redirectUri = (deps: AppDeps) => `${deps.webOrigin}/api/slack/oauth/callback`;

/** The dashboard route that starts an install (the browser then goes to Slack). */
export function registerSlackInstallRoute(router: Router, deps: AppDeps): void {
  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/slack/install',
      tags: ['alerts'],
      summary: 'Where to send the browser to install the Aperture Slack app for this org',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ url: z.url() })), ...errorResponses },
    }),
    (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const slack = deps.slack;
      if (slack === undefined) {
        throw new AppError(503, 'slack_not_configured', 'the Slack app is not configured on this deployment');
      }
      const state = signState(deps.pepper, {
        orgId,
        userId: user.id,
        exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
      });
      const url = new URL('https://slack.com/oauth/v2/authorize');
      url.searchParams.set('client_id', slack.clientId);
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('redirect_uri', redirectUri(deps));
      url.searchParams.set('state', state);
      return c.json({ url: url.toString() }, 200);
    },
  );
}

interface BlockAction {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  actions?: { action_id?: string; value?: string }[];
  response_url?: string;
}

/** OAuth callback and interactions: Slack calls these directly, so they sit outside /api/v1. */
export function registerSlackWebhooks(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const fetchImpl = deps.jobs.fetch ?? fetch;

  app.get('/api/slack/oauth/callback', async (c) => {
    const slack = deps.slack;
    const state = readState(deps.pepper, c.req.query('state') ?? '');
    const code = c.req.query('code');
    if (slack === undefined || state === undefined || code === undefined) {
      return c.text('This Slack install link is invalid or expired. Start again from Aperture settings.', 400);
    }
    const response = await fetchImpl(`${SLACK_API}/oauth.v2.access`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: slack.clientId,
        client_secret: slack.clientSecret,
        code,
        redirect_uri: redirectUri(deps),
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      access_token?: string;
      team?: { id?: string; name?: string };
      incoming_webhook?: { channel?: string; channel_id?: string };
    };
    const teamId = result.team?.id;
    const channelId = result.incoming_webhook?.channel_id;
    if (result.ok !== true || result.access_token === undefined || teamId === undefined || channelId === undefined) {
      deps.logger.warn({ orgId: state.orgId }, 'Slack install failed');
      return c.text('Slack did not complete the install. Try again from Aperture settings.', 502);
    }
    const token = result.access_token;
    await withOrg(deps.db, state.orgId, async (tx) => {
      await tx
        .update(schema.connections)
        .set({ status: 'disabled' })
        .where(and(eq(schema.connections.orgId, state.orgId), eq(schema.connections.provider, 'slack_app')));
      const id = uuidv7();
      await tx.insert(schema.connections).values({
        id,
        orgId: state.orgId,
        provider: 'slack_app',
        name: `Slack · ${result.team?.name ?? teamId}`,
        fingerprint: `${teamId}:${id}`,
        secret: encryptSecret(token, `${state.orgId}|${id}`, deps.ring),
        config: {
          teamId,
          teamName: result.team?.name ?? null,
          channelId,
          channel: result.incoming_webhook?.channel ?? null,
        },
      });
      await appendAuditEvent(tx, state.orgId, {
        actor: `user:${state.userId}`,
        action: 'alerts.slack_app_installed',
        subject: `org:${state.orgId}`,
        data: { teamId, channel: result.incoming_webhook?.channel ?? null },
      });
    });
    return c.redirect(`${deps.webOrigin}/orgs/${state.orgId}/settings/alerts?slack=installed`, 302);
  });

  app.post('/api/slack/interactions', async (c) => {
    const slack = deps.slack;
    if (slack === undefined) return c.text('not configured', 404);
    const raw = await c.req.text();
    const verified = verifySlackSignature(
      slack.signingSecret,
      {
        timestamp: c.req.header('x-slack-request-timestamp') ?? null,
        signature: c.req.header('x-slack-signature') ?? null,
      },
      raw,
    );
    if (!verified) return c.text('invalid signature', 401);

    let payload: BlockAction;
    try {
      payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '') as BlockAction;
    } catch {
      return c.text('bad payload', 400);
    }
    const action = payload.actions?.[0];
    if (payload.type !== 'block_actions' || (action?.action_id !== 'approve' && action?.action_id !== 'deny')) {
      return c.body(null, 200); // "Open Aperture" and anything else needs no answer.
    }
    const approvalId = action.value ?? '';
    const reply = async (text: string, replace: boolean) => {
      if (payload.response_url?.startsWith('https://hooks.slack.com/') !== true) return;
      await fetchImpl(payload.response_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          replace ? { replace_original: true, text } : { replace_original: false, response_type: 'ephemeral', text },
        ),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    };

    try {
      const decided = await decideFromSlack(deps, fetchImpl, {
        teamId: payload.team?.id ?? '',
        slackUserId: payload.user?.id ?? '',
        approvalId,
        approve: action.action_id === 'approve',
      });
      await reply(decided, true);
    } catch (error) {
      if (error instanceof SlackRefusal || error instanceof MandateError) await reply(error.message, false);
      else {
        deps.logger.error({ err: error }, 'Slack interaction failed');
        await reply('Aperture could not record that. Try again from the dashboard.', false);
      }
    }
    return c.body(null, 200);
  });
}

class SlackRefusal extends Error {}

async function decideFromSlack(
  deps: AppDeps,
  fetchImpl: NonNullable<AppDeps['jobs']['fetch']>,
  input: { teamId: string; slackUserId: string; approvalId: string; approve: boolean },
): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(input.approvalId)) throw new SlackRefusal('That button no longer points at a request.');
  // Which org installed this workspace (the approval must belong to it).
  const [installed] = await withSystem(deps.db, (tx) =>
    tx
      .select({ connection: schema.connections, orgId: schema.approvals.orgId })
      .from(schema.approvals)
      .innerJoin(
        schema.connections,
        and(
          eq(schema.connections.orgId, schema.approvals.orgId),
          eq(schema.connections.provider, 'slack_app'),
          eq(schema.connections.status, 'active'),
          sql`${schema.connections.config}->>'teamId' = ${input.teamId}`,
        ),
      )
      .where(eq(schema.approvals.id, input.approvalId)),
  );
  if (installed === undefined) throw new SlackRefusal('This Slack workspace is not connected to that organization.');
  const { connection, orgId } = installed;

  // Slack user → verified email → Aperture member (A4).
  const token = decryptSecret(connection.secret, `${orgId}|${connection.id}`, deps.ring);
  const info = await slackApi(fetchImpl, token, 'users.info', { user: input.slackUserId }).catch(() => undefined);
  const slackUser = info?.user as { is_email_confirmed?: boolean; profile?: { email?: string } } | undefined;
  const email = slackUser?.profile?.email;
  if (email === undefined || slackUser?.is_email_confirmed !== true) {
    throw new SlackRefusal('Aperture needs your verified Slack email to match your Aperture account.');
  }

  return withOrg(deps.db, orgId, async (tx) => {
    const [member] = await tx
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        role: schema.members.role,
        teamId: schema.members.teamId,
      })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(
        and(
          eq(schema.members.orgId, orgId),
          sql`lower(${schema.users.email}) = lower(${email})`,
          eq(schema.users.emailVerified, true),
        ),
      );
    if (member === undefined || !can(member.role, 'approvals.decide')) {
      throw new SlackRefusal('You are not an approver in this Aperture organization.');
    }
    if (grantFor(member.role, 'approvals.decide') === 'team') {
      const [requester] = await tx
        .select({ teamId: schema.principals.teamId })
        .from(schema.approvals)
        .innerJoin(schema.principals, eq(schema.principals.id, schema.approvals.requesterPrincipalId))
        .where(eq(schema.approvals.id, input.approvalId));
      if (requester?.teamId !== member.teamId) throw new SlackRefusal('You can only decide requests from your team.');
    }
    const approval = await decideApproval(tx, deps.ring, {
      orgId,
      approvalId: input.approvalId,
      deciderUserId: member.userId,
      approve: input.approve,
      note: 'via Slack',
    });
    await appendAuditEvent(tx, orgId, {
      actor: `user:${member.userId}`,
      action: input.approve ? 'approval.approved' : 'approval.denied',
      subject: `approval:${approval.id}`,
      data: { via: 'slack', slackUser: input.slackUserId, resource: approval.resource },
    });
    return `${input.approve ? '✅ Approved' : '⛔ Denied'} by ${slackEscape(member.name)}: ${slackEscape(approval.purpose)} (${slackEscape(approval.resource)})`;
  });
}
