import { fetchPriceCatalog } from '@aperture/connectors';
import {
  expireHolds,
  schema,
  upsertMediaPrices,
  upsertPrices,
  verifyCounters,
  withOrg,
  withSystem,
} from '@aperture/db';
import { fetchMediaCatalog } from '@aperture/media';
import { queueAlert } from './alerts';
import { dbOf, type JobDeps } from './deps';

/** Daily price refresh from OpenRouter's public catalogs: text (4.7) and media (6.1). */
export async function syncPrices(deps: JobDeps): Promise<number> {
  const options = deps.fetch === undefined ? {} : { fetch: deps.fetch };
  const catalog = await fetchPriceCatalog(options);
  let written = await withSystem(dbOf(deps), (tx) => upsertPrices(tx, catalog));
  try {
    const media = await fetchMediaCatalog(options);
    written += await withSystem(dbOf(deps), (tx) => upsertMediaPrices(tx, media));
  } catch (error) {
    deps.logger.warn({ err: error }, 'media price sync failed; text prices were updated');
  }
  return written;
}

/** Applies each expired hold's `onExpiry` action, across orgs. */
export async function expireAllHolds(deps: JobDeps) {
  return withSystem(dbOf(deps), (tx) => expireHolds(tx));
}

/** Nightly: budget counters must equal the journal (L8, invariant I2). Drift is an alert. */
export async function verifyLedgers(deps: JobDeps): Promise<number> {
  const orgs = await withSystem(dbOf(deps), (tx) => tx.select({ id: schema.orgs.id }).from(schema.orgs));
  let drifting = 0;
  for (const org of orgs) {
    const result = await withOrg(dbOf(deps), org.id, (tx) => verifyCounters(tx, org.id));
    if (result.ok) continue;
    drifting += 1;
    deps.logger.error({ orgId: org.id, drift: result.drift.length }, 'budget counters drifted from the ledger');
    await queueAlert(deps, org.id, {
      dedupeKey: `drift:${new Date().toISOString().slice(0, 10)}`,
      kind: 'ledger_drift',
      payload: { budgets: result.drift.length },
    });
  }
  return drifting;
}
