export {
  connect,
  defaultMigrationsFolder,
  runMigrations,
  withOrg,
  withSystem,
  type ConnectOptions,
  type Database,
  type DatabaseHandle,
  type DbOrTx,
  type Transaction,
} from './client';
export * as schema from './schema';
export {
  EntityError,
  createBudget,
  createOrg,
  createPrincipal,
  createTeam,
  setBudgetLimit,
  type CreateBudgetInput,
} from './entities';
export {
  LedgerError,
  adjust,
  budgetHeadroom,
  expireHolds,
  recordSpend,
  refund,
  release,
  reserve,
  settle,
  verifyCounters,
  type BudgetBreach,
  type CounterDrift,
  type ExpiryAction,
  type ExpiryResult,
  type Headroom,
  type Hold,
  type LedgerEntry,
  type RecordSpendInput,
  type RecordSpendResult,
  type ReserveInput,
  type ReserveResult,
  type SettleInput,
  type ThresholdCrossing,
} from './ledger';
export { appendAuditEvent, auditRoot, exportAuditEvents, type AuditEventInput } from './audit';
export {
  createConnection,
  listConnections,
  openCredentialSecret,
  readConnectionSecret,
  rewrapConnectionSecrets,
  sealCredentialSecret,
  type ConnectionSummary,
} from './connections';
export { lookupPrice, upsertPrices, type PriceRow } from './prices';
// Query helpers, re-exported so every package uses this package's single drizzle-orm instance.
export { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
