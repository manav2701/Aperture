import { decryptSecret } from '@aperture/crypto';
import { formatUsd, micros, periodKey } from '@aperture/core';
import { and, asc, eq, inArray, isNull, lt, schema, sql, withOrg, withSystem } from '@aperture/db';
import { v7 as uuidv7 } from 'uuid';
import { dbOf, type JobDeps } from './deps';
import { alertBlocks, slackApi } from './slack';

/** Budgets without thresholds of their own still warn at these percentages. */
const DEFAULT_THRESHOLDS = [80, 100];
const MAX_ATTEMPTS = 5;
const SLACK_PREFIX = 'https://hooks.slack.com/';

export type AlertKind =
  | 'budget_threshold'
  | 'credential_revoked'
  | 'connection_broken'
  | 'unpriced_model'
  | 'ledger_drift'
  | 'media_stuck'
  | 'approval_requested'
  | 'card_unknown'
  | 'card_unseen_authorization'
  | 'card_unheld_capture'
  | 'card_decisions_timing_out';

/** Queues an alert once per dedupe key (C2: a threshold alerts once per budget period). */
export async function queueAlert(
  deps: JobDeps,
  orgId: string,
  alert: { dedupeKey: string; kind: AlertKind; payload: Record<string, string | number> },
): Promise<void> {
  await withOrg(dbOf(deps), orgId, (tx) =>
    tx
      .insert(schema.alertLog)
      .values({ id: uuidv7(), orgId, dedupeKey: alert.dedupeKey, kind: alert.kind, payload: alert.payload })
      .onConflictDoNothing(),
  );
}

/** Checks every budget's current period against its thresholds (all rails: gateway, providers, cards). */
export async function scanBudgetThresholds(deps: JobDeps): Promise<number> {
  const rows = await withSystem(dbOf(deps), (tx) =>
    tx
      .select({ budget: schema.budgets, timezone: schema.orgs.timezone })
      .from(schema.budgets)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.budgets.orgId))
      .where(and(isNull(schema.budgets.archivedAt), eq(schema.budgets.unit, 'micros'))),
  );
  if (rows.length === 0) return 0;
  const now = new Date();
  const keyed = rows.map((row) => ({ ...row, periodKey: periodKey(now, row.budget.period, row.timezone) }));
  const usage = await withSystem(dbOf(deps), (tx) =>
    tx
      .select()
      .from(schema.budgetUsage)
      .where(
        inArray(
          schema.budgetUsage.budgetId,
          keyed.map((row) => row.budget.id),
        ),
      ),
  );

  let queued = 0;
  for (const { budget, periodKey: key } of keyed) {
    const current = usage.find((row) => row.budgetId === budget.id && row.periodKey === key);
    if (current === undefined || budget.limitAmount <= 0n) continue;
    const used = current.held + current.spent;
    const thresholds = budget.alertThresholds.length > 0 ? budget.alertThresholds : DEFAULT_THRESHOLDS;
    for (const threshold of thresholds) {
      if (used * 100n < budget.limitAmount * BigInt(threshold)) continue;
      await queueAlert(deps, budget.orgId, {
        dedupeKey: `budget:${budget.id}:${String(threshold)}:${key}`,
        kind: 'budget_threshold',
        payload: {
          budget: budget.name,
          threshold,
          used: formatUsd(micros(used)),
          limit: formatUsd(micros(budget.limitAmount)),
          period: budget.period,
          mode: budget.mode,
        },
      });
      queued += 1;
    }
  }
  return queued;
}

const s = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

export function alertMessage(kind: string, payload: Record<string, unknown>): { subject: string; text: string } {
  switch (kind) {
    case 'budget_threshold': {
      const hit = Number(payload.threshold) >= 100;
      return {
        subject: `Budget "${s(payload.budget)}" ${hit ? 'is used up' : `reached ${s(payload.threshold)}%`}`,
        text:
          `"${s(payload.budget)}" has used $${s(payload.used)} of its $${s(payload.limit)} ${s(payload.period)}ly limit.` +
          (hit && payload.mode === 'hard' ? ' New spending under it is being blocked.' : ''),
      };
    }
    case 'credential_revoked':
      return {
        subject: `Aperture revoked a ${s(payload.provider)} key`,
        text: `The key "${s(payload.credential)}" was revoked at ${s(payload.provider)} because the budget "${s(payload.budget)}" is used up.`,
      };
    case 'connection_broken':
      return {
        subject: `${s(payload.name)} stopped working`,
        text: `Aperture can no longer reach ${s(payload.provider)} (${s(payload.error)}). Spend there is not being tracked or enforced until you reconnect it.`,
      };
    case 'unpriced_model':
      return {
        subject: `No price for ${s(payload.model)}`,
        text: `Usage of ${s(payload.model)} on ${s(payload.provider)} could not be priced, so it is not counted against budgets yet.`,
      };
    case 'media_stuck':
      return {
        subject: `A ${s(payload.model)} job is taking unusually long`,
        text: `Media job ${s(payload.job)} has been running for ${s(payload.minutes)} minutes. Its reservation stays held until the provider finishes or Aperture gives up after 24 hours.`,
      };
    case 'approval_requested':
      return {
        subject: `${s(payload.requester)} is asking to spend up to $${s(payload.amount)}`,
        text: `${s(payload.requester)} wants to use ${s(payload.resource)} for "${s(payload.purpose)}" (up to $${s(payload.amount)}). Approve or deny it in Aperture; it is denied automatically after 24 hours.`,
      };
    case 'card_unknown':
      return {
        subject: 'A card Aperture did not issue tried to spend',
        text: `Stripe asked about card ${s(payload.card)}, which Aperture doesn't know. It was declined.`,
      };
    case 'card_unseen_authorization':
      return {
        subject: 'Stripe approved a card purchase without asking Aperture',
        text: `Authorization ${s(payload.authorization)} at ${s(payload.merchant)} was approved by Stripe (${s(payload.reason)}). It is counted against budgets when captured. Check that the authorization timeout is set to decline.`,
      };
    case 'card_unheld_capture':
      return {
        subject: 'Money moved on a card without an authorization',
        text: `Transaction ${s(payload.transaction)} at ${s(payload.merchant)} was captured without an authorization (a force capture). It is counted as spend; single-use cards are frozen. Consider a dispute.`,
      };
    case 'card_decisions_timing_out':
      return {
        subject: 'Card decisions are timing out',
        text: `${s(payload.count)} card authorizations in the last ${s(payload.days)} days were decided by Stripe because Aperture did not answer in time.`,
      };
    default:
      return { subject: `Aperture alert: ${kind}`, text: JSON.stringify(payload) };
  }
}

/** Sends queued alerts by email to owners, admins and finance, and to Slack when connected. */
export async function dispatchAlerts(deps: JobDeps): Promise<number> {
  const pending = await withSystem(dbOf(deps), (tx) =>
    tx
      .select()
      .from(schema.alertLog)
      .where(and(isNull(schema.alertLog.sentAt), lt(schema.alertLog.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(schema.alertLog.createdAt))
      .limit(50),
  );
  let sent = 0;
  for (const alert of pending) {
    const { subject, text } = alertMessage(alert.kind, alert.payload as Record<string, unknown>);
    const link =
      alert.kind === 'approval_requested'
        ? `${deps.webOrigin}/orgs/${alert.orgId}/approvals`
        : `${deps.webOrigin}/orgs/${alert.orgId}`;
    try {
      const { recipients, slack, slackApp } = await withOrg(dbOf(deps), alert.orgId, async (tx) => {
        const people = await tx
          .select({ email: schema.users.email })
          .from(schema.members)
          .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(
            and(eq(schema.members.orgId, alert.orgId), inArray(schema.members.role, ['owner', 'admin', 'finance'])),
          );
        const hooks = await tx
          .select()
          .from(schema.connections)
          .where(
            and(
              eq(schema.connections.orgId, alert.orgId),
              inArray(schema.connections.provider, ['slack', 'slack_app']),
              eq(schema.connections.status, 'active'),
            ),
          );
        return {
          recipients: people.map((person) => person.email),
          slack: hooks.find((hook) => hook.provider === 'slack'),
          slackApp: hooks.find((hook) => hook.provider === 'slack_app'),
        };
      });
      for (const to of recipients)
        await deps.email.send({
          to,
          subject,
          text: `${text}

${link}`,
        });
      if (slackApp !== undefined) {
        // The installed app posts to its channel, with Approve / Deny buttons on approval requests.
        const token = decryptSecret(slackApp.secret, `${alert.orgId}|${slackApp.id}`, deps.ring);
        const config = slackApp.config as { channelId?: string };
        const payload = alert.payload as Record<string, unknown>;
        await slackApi(deps.fetch ?? fetch, token, 'chat.postMessage', {
          channel: config.channelId,
          text: `${subject}: ${text}`,
          blocks: alertBlocks({
            kind: alert.kind,
            subject,
            text,
            link,
            approvalId: typeof payload.approval === 'string' ? payload.approval : undefined,
          }),
        });
      } else if (slack !== undefined) {
        const url = decryptSecret(slack.secret, `${alert.orgId}|${slack.id}`, deps.ring);
        if (!url.startsWith(SLACK_PREFIX)) throw new Error('Slack webhook URL is not a hooks.slack.com URL');
        const response = await (deps.fetch ?? fetch)(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: `*${subject}*
${text}
<${link}|Open Aperture>`,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Slack answered ${String(response.status)}`);
      }
      await withOrg(dbOf(deps), alert.orgId, (tx) =>
        tx
          .update(schema.alertLog)
          .set({ sentAt: new Date(), attempts: sql`${schema.alertLog.attempts} + 1` })
          .where(eq(schema.alertLog.id, alert.id)),
      );
      sent += 1;
    } catch (error) {
      deps.logger.warn({ alertId: alert.id, err: error }, 'alert delivery failed');
      await withOrg(dbOf(deps), alert.orgId, (tx) =>
        tx
          .update(schema.alertLog)
          .set({ attempts: sql`${schema.alertLog.attempts} + 1`, lastError: (error as Error).message.slice(0, 300) })
          .where(eq(schema.alertLog.id, alert.id)),
      );
    }
  }
  return sent;
}
