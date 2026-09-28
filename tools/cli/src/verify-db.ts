/**
 * Verifies a whole database, e.g. one just restored from backup (plan/phases/phase-10 §10.2):
 * every org's budget counters match its ledger, and every org's audit chain is intact.
 *
 *   DATABASE_URL=postgres://owner@…/aperture pnpm --filter @aperture/cli verify-db
 *
 * Exit 0: "ledger verified, audit chain verified". Exit 1: the first problems found.
 */
import { env, exit, stdout } from 'node:process';
import { connect, exportAuditEvents, schema, verifyCounters, withOrg, withSystem } from '@aperture/db';
import { verifyAuditExport } from './verify';

const url = env.DATABASE_URL;
if (url === undefined) {
  stdout.write('Set DATABASE_URL (an owner connection to the database to verify).\n');
  exit(2);
}
const database = connect(url, { max: 2 });
const started = Date.now();
let problems = 0;
try {
  const orgs = await withSystem(database.db, (tx) =>
    tx.select({ id: schema.orgs.id, name: schema.orgs.name }).from(schema.orgs),
  );
  let events = 0;
  for (const org of orgs) {
    const counters = await withOrg(database.db, org.id, (tx) => verifyCounters(tx, org.id));
    if (!counters.ok) {
      problems += 1;
      stdout.write(
        `LEDGER DRIFT in ${org.name} (${org.id}): ${JSON.stringify(counters.drift, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}\n`,
      );
    }
    const records = await withOrg(database.db, org.id, (tx) => exportAuditEvents(tx, org.id));
    events += records.length;
    if (records.length === 0) continue;
    const chain = verifyAuditExport(records.map((record) => JSON.stringify(record)).join('\n'));
    if (!chain.ok) {
      problems += 1;
      stdout.write(`AUDIT CHAIN BROKEN in ${org.name} (${org.id}) at ${chain.where}: ${chain.reason}\n`);
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (problems === 0) {
    stdout.write(
      `${String(orgs.length)} orgs, ${String(events)} audit events in ${seconds}s: ledger verified, audit chain verified\n`,
    );
  }
} finally {
  await database.close();
}
exit(problems === 0 ? 0 : 1);
