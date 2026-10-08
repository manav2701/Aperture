import { dispatchAlerts, scanBudgetThresholds } from './alerts';
import { expirePendingApprovals, notifyApprovals } from './approvals';
import { expireTaskCards, reconcileCards, syncFxRates } from './cards';
import { applyRetention, processDeletions } from './privacy';
import { anchorAudits, reconcileX402, syncStablePrices, watchX402 } from './x402';
import type { JobDeps } from './deps';
import { expireAllHolds, syncPrices, verifyLedgers } from './maintenance';
import { pollMediaJobs } from './media';
import { startScheduler, type Job, type Scheduler } from './scheduler';
import { syncAllConnections } from './sync';
import { runAllPosture } from './posture';
import { checkSeatOverage, refreshAllSeatIdleness, syncAllSeatConnections } from './seats';

export { alertMessage, dispatchAlerts, queueAlert, scanBudgetThresholds, type AlertKind } from './alerts';
export { expirePendingApprovals, notifyApprovals } from './approvals';
export { expireTaskCards, reconcileCards, syncFxRates } from './cards';
export { DELETION_GRACE_DAYS, applyRetention, processDeletions } from './privacy';
export { anchorAudits, reconcileX402, rpcForConnection, syncStablePrices, watchX402 } from './x402';
export { SYSTEM_ACTOR, type JobDeps } from './deps';
export { expireAllHolds, syncPrices, verifyLedgers } from './maintenance';
export { pollMediaJobs } from './media';
export { SLACK_API, SlackApiError, alertBlocks, slackApi, slackEscape } from './slack';
export { startScheduler, type Job, type Scheduler } from './scheduler';
export { REVOCABLE_PROVIDERS, runAllPosture, runPosture, type PostureRun } from './posture';
export {
  checkSeatOverage,
  refreshAllSeatIdleness,
  seatConnectorForConnection,
  syncAllSeatConnections,
  syncSeatConnection,
  type SeatSyncResult,
} from './seats';
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
    job('x402.watch', 20_000, () => watchX402(deps)),
    job('x402.reconcile', 24 * 60 * MINUTE, () => reconcileX402(deps)),
    job('prices.stable', 5 * MINUTE, () => syncStablePrices(deps)),
    job('audit.anchor', 60 * MINUTE, () => anchorAudits(deps)),
    job('privacy.retention', 24 * 60 * MINUTE, () => applyRetention(deps)),
    job('privacy.deletions', 60 * MINUTE, () => processDeletions(deps)),
    job('posture.run', 24 * 60 * MINUTE, () => runAllPosture(deps)),
    job('seats.sync', 6 * 60 * MINUTE, () => syncAllSeatConnections(deps)),
    job('seats.idle', 24 * 60 * MINUTE, () => refreshAllSeatIdleness(deps)),
    job('seats.overage', 24 * 60 * MINUTE, () => checkSeatOverage(deps)),
  ];
}

export function startStandardJobs(deps: JobDeps): Scheduler {
  return startScheduler({ database: deps.database, logger: deps.logger, jobs: standardJobs(deps) });
}
