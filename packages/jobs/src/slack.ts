import type { FetchLike } from '@aperture/connectors';

/*
 * The Slack app (plan/phases/phase-07 §7.2): after an org installs it, alerts go to the chosen
 * channel through chat.postMessage, and approval requests carry Approve / Deny buttons whose
 * clicks come back to the API's /api/slack/interactions (verified and mapped there).
 */

export const SLACK_API = 'https://slack.com/api';

export class SlackApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Slack answered ${code}`);
    this.name = 'SlackApiError';
    this.code = code;
  }
}

/** Calls a Slack Web API method with a bot token; Slack reports errors as `ok: false`. */
export async function slackApi(
  fetchImpl: FetchLike,
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await response.json().catch(() => ({ ok: false, error: `http_${String(response.status)}` }))) as Record<
    string,
    unknown
  >;
  if (json.ok !== true) throw new SlackApiError(typeof json.error === 'string' ? json.error : 'unknown_error');
  return json;
}

/** Slack's mrkdwn treats &, < and > specially; everything we interpolate is escaped. */
export const slackEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function alertBlocks(input: {
  kind: string;
  subject: string;
  text: string;
  link: string;
  approvalId?: string | undefined;
}): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${slackEscape(input.subject)}*\n${slackEscape(input.text)}` },
    },
  ];
  const buttons: Record<string, unknown>[] = [];
  if (input.kind === 'approval_requested' && input.approvalId !== undefined) {
    buttons.push(
      {
        type: 'button',
        action_id: 'approve',
        style: 'primary',
        text: { type: 'plain_text', text: 'Approve' },
        value: input.approvalId,
      },
      {
        type: 'button',
        action_id: 'deny',
        style: 'danger',
        text: { type: 'plain_text', text: 'Deny' },
        value: input.approvalId,
      },
    );
  }
  buttons.push({
    type: 'button',
    action_id: 'open',
    text: { type: 'plain_text', text: 'Open Aperture' },
    url: input.link,
  });
  blocks.push({ type: 'actions', elements: buttons });
  return blocks;
}
