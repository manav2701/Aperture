/**
 * Operator commands (docs/runbooks). All take an owner connection in DATABASE_URL.
 *
 *   pnpm --filter @aperture/cli admin pilot <orgId> <days>     # unlimited plan until the date
 *   pnpm --filter @aperture/cli admin rotate-kek               # re-wrap secrets under the newest APERTURE_KEK_V<n>
 *   pnpm --filter @aperture/cli admin rotate-signer-kek        # same for x402 delegate keys (SIGNER_KEK_V<n>)
 *   pnpm --filter @aperture/cli admin rotate-attestation-key   # retire the platform attestation key, make a new one
 */
import { argv, env, exit, stdout } from 'node:process';
import { keyRingFromEnv, rewrapSecret } from '@aperture/crypto';
import { connect, eq, isNotNull, rotatePlatformSigningKey, schema, withSystem } from '@aperture/db';

const [command, ...args] = argv.slice(2);
if (env.DATABASE_URL === undefined) {
  stdout.write('Set DATABASE_URL (owner connection).\n');
  exit(2);
}
const database = connect(env.DATABASE_URL, { max: 2 });

try {
  if (command === 'pilot') {
    const [orgId, days] = args;
    if (orgId === undefined || days === undefined || !/^\d+$/.test(days))
      throw new Error('usage: admin pilot <orgId> <days>');
    const endsAt = new Date(Date.now() + Number(days) * 86_400_000);
    await withSystem(database.db, (tx) =>
      tx
        .insert(schema.orgBilling)
        .values({ orgId, plan: 'pilot', pilotEndsAt: endsAt })
        .onConflictDoUpdate({
          target: schema.orgBilling.orgId,
          set: { plan: 'pilot', pilotEndsAt: endsAt, updatedAt: new Date() },
        }),
    );
    stdout.write(`org ${orgId} is a pilot until ${endsAt.toISOString()}\n`);
  } else if (command === 'rotate-kek') {
    const ring = keyRingFromEnv(env);
    let count = 0;
    await withSystem(database.db, async (tx) => {
      for (const row of await tx.select().from(schema.connections)) {
        await tx
          .update(schema.connections)
          .set({ secret: rewrapSecret(row.secret, `${row.orgId}|${row.id}`, ring) })
          .where(eq(schema.connections.id, row.id));
        count += 1;
      }
      for (const row of await tx.select().from(schema.credentials).where(isNotNull(schema.credentials.secret))) {
        await tx
          .update(schema.credentials)
          .set({ secret: rewrapSecret(row.secret, `${row.orgId}|credential|${row.id}`, ring) })
          .where(eq(schema.credentials.id, row.id));
        count += 1;
      }
      for (const row of await tx.select().from(schema.orgSigningKeys)) {
        await tx
          .update(schema.orgSigningKeys)
          .set({ privateKey: rewrapSecret(row.privateKey, `${row.orgId}|signing-key|${row.kid}`, ring) })
          .where(eq(schema.orgSigningKeys.kid, row.kid));
        count += 1;
      }
      // Retired attestation keys too: they're never used again, but V1 must be removable.
      for (const row of await tx.select().from(schema.platformSigningKeys)) {
        await tx
          .update(schema.platformSigningKeys)
          .set({ privateKey: rewrapSecret(row.privateKey, `platform|attestation-key|${row.kid}`, ring) })
          .where(eq(schema.platformSigningKeys.kid, row.kid));
        count += 1;
      }
    });
    stdout.write(`re-wrapped ${String(count)} secrets under APERTURE_KEK_V${String(ring.currentVersion)}\n`);
  } else if (command === 'rotate-signer-kek') {
    const signerEnv = Object.fromEntries(
      Object.entries(env)
        .filter(([name]) => /^SIGNER_KEK_V\d+$/.test(name))
        .map(([name, value]) => [name.replace('SIGNER_', 'APERTURE_'), value]),
    );
    const ring = keyRingFromEnv(signerEnv);
    let count = 0;
    await withSystem(database.db, async (tx) => {
      for (const row of await tx
        .select()
        .from(schema.x402Accounts)
        .where(isNotNull(schema.x402Accounts.delegateSecret))) {
        await tx
          .update(schema.x402Accounts)
          .set({ delegateSecret: rewrapSecret(row.delegateSecret, `${row.orgId}|x402-delegate|${row.id}`, ring) })
          .where(eq(schema.x402Accounts.id, row.id));
        count += 1;
      }
    });
    stdout.write(`re-wrapped ${String(count)} delegate keys under SIGNER_KEK_V${String(ring.currentVersion)}\n`);
  } else if (command === 'rotate-attestation-key') {
    const ring = keyRingFromEnv(env);
    const kid = await withSystem(database.db, (tx) => rotatePlatformSigningKey(tx, ring));
    stdout.write(`new attestation key ${kid}; retired keys stay in the JWKS so earlier attestations still verify\n`);
  } else {
    throw new Error('commands: pilot <orgId> <days> | rotate-kek | rotate-signer-kek | rotate-attestation-key');
  }
} catch (error) {
  stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
} finally {
  await database.close();
}
