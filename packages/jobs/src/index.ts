import { dispatchAlerts, scanBudgetThresholds } from './alerts';
import { expirePendingApprovals, notifyApprovals } from './approvals';
import { expireTaskCards, reconcileCards, syncFxRates } from './cards';
import type { JobDeps } from './deps';
import { expireAllHolds, syncPrices, verifyLedgers } from './maintenance';
import { pollMediaJobs } from './media';
import { startScheduler, type Job, type Scheduler } from './scheduler';
import { syncAllConnections } from './sync';

export { alertMessage, dispatchAlerts, queueAlert, scanBudgetThresholds, type AlertKind } from './alerts';
export { expirePendingApprovals, notifyApprovals } from './approvals';
export { expireTaskCards, reconcileCards, syncFxRates } from './cards';
export { SYSTEM_ACTOR, type JobDeps } from './deps';
export { expireAllHolds, syncPrices, verifyLedgers } from './maintenance';
export { pollMediaJobs } from './media';
export { SLACK_API, SlackApiError, alertBlocks, slackApi, slackEscape } from './slack';
export { startScheduler, type Job, type Scheduler } from './scheduler';
export {
  connectorForConnection,
  syncAllConnections,
  syncConnection,
  unassignedPrincipal,
  type SyncResult,
} from './sync';

const MINUTE = 60_000;

/** The standard job set; the API (RUN_WORKER=true) and apps/worker both start it. */
export function standardJobs(deps: JobDeps): Job[] {
  const job = (name: string, everyMs: number, run: () => Promise<unknown>): Job => ({
    name,
    everyMs,
    run: async () => {
      await run();
    },
  });
  return [
    job('connector.sync', MINUTE, () => syncAllConnections(deps)),
    job('alerts.scan', MINUTE, () => scanBudgetThresholds(deps)),
    job('alerts.dispatch', 30_000, () => dispatchAlerts(deps)),
    job('holds.expire', 30_000, () => expireAllHolds(deps)),
    job('prices.sync', 24 * 60 * MINUTE, () => syncPrices(deps)),
    job('ledger.verify', 24 * 60 * MINUTE, () => verifyLedgers(deps)),
    job('media.poll', 10_000, () => pollMediaJobs(deps)),
    job('approvals.notify', 15_000, () => notifyApprovals(deps)),
    job('approvals.expire', 5 * MINUTE, () => expirePendingApprovals(deps)),
    job('fx.sync', 6 * 60 * MINUTE, () => syncFxRates(deps)),
    job('cards.expire', 10 * MINUTE, () => expireTaskCards(deps)),
    job('cards.reconcile', 24 * 60 * MINUTE, () => reconcileCards(deps)),
  ];
}

export function startStandardJobs(deps: JobDeps): Scheduler {
  return startScheduler({ database: deps.database, logger: deps.logger, jobs: standardJobs(deps) });
}
