import { merkleRoot, decryptSecret } from '@aperture/crypto';
import { and, asc, eq, gte, lt, recordSpend, release, schema, settle, sql, withOrg, withSystem } from '@aperture/db';
import {
  anchorMemo,
  atomicToMicros,
  buildMemoTransaction,
  destinationFor,
  fetchStablecoinPrices,
  notaryFromSecret,
  paymentsOutOf,
  solanaRpc,
  type RpcFetch,
  type SolanaNetwork,
  type SolanaRpc,
} from '@aperture/x402';
import { queueAlert } from './alerts';
import { dbOf, type JobDeps } from './deps';

/*
 * x402 upkeep (plan/phases/phase-09 §9.4, §9.7): the settlement watcher (on-chain truth for
 * every signed payment, X4, X6), the nightly allowance check, stablecoin prices for the depeg
 * guard (X13), and daily audit anchoring.
 */

/** Blocks after lastValidBlockHeight before an unsent transaction is certainly dead. */
const EXPIRY_MARGIN_BLOCKS = 150n;
const PUBLIC_RPC: Record<SolanaNetwork, string> = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
};

type Connection = typeof schema.connections.$inferSelect;

const rpcFetch =
  (deps: JobDeps): RpcFetch =>
  (input, init) =>
    (deps.fetch ?? fetch)(input, init ?? {});

export function rpcForConnection(deps: JobDeps, connection: Connection): SolanaRpc {
  const config = connection.config as { network?: SolanaNetwork };
  let urls: string[] = [];
  try {
    const secret = JSON.parse(decryptSecret(connection.secret, `${connection.orgId}|${connection.id}`, deps.ring)) as {
      rpcUrls?: string[];
    };
    urls = secret.rpcUrls ?? [];
  } catch {
    // No stored RPC URLs: the public endpoint (rate-limited, fine for devnet).
  }
  return solanaRpc(urls.length > 0 ? urls : [PUBLIC_RPC[config.network ?? 'devnet']], rpcFetch(deps));
}

export async function watchX402(deps: JobDeps): Promise<{ settled: number; expired: number; unknown: number }> {
  const pending = await withSystem(dbOf(deps), (tx) =>
    tx
      .select({ account: schema.x402Accounts, connection: schema.connections })
      .from(schema.x402Accounts)
      .innerJoin(schema.connections, eq(schema.connections.id, schema.x402Accounts.connectionId))
      .where(
        sql`exists (select 1 from x402_payments p where p.account_id = ${schema.x402Accounts.id} and p.status = 'signed')`,
      ),
  );
  const totals = { settled: 0, expired: 0, unknown: 0 };
  for (const { account, connection } of pending) {
    try {
      const rpc = rpcForConnection(deps, connection);
      const payments = await withOrg(dbOf(deps), account.orgId, (tx) =>
        tx
          .select()
          .from(schema.x402Payments)
          .where(and(eq(schema.x402Payments.accountId, account.id), eq(schema.x402Payments.status, 'signed'))),
      );
      const signatures = await rpc.getSignaturesForAddress(account.budgetAccount, {
        ...(account.cursor === null ? {} : { until: account.cursor }),
      });
      for (const entry of [...signatures].reverse()) {
        if (entry.err != null) continue;
        const transaction = await rpc.getTransaction(entry.signature);
        if (transaction === null) continue;
        for (const [index, transfer] of paymentsOutOf(transaction, account.budgetAccount).entries()) {
          const payment = payments.find((candidate) => candidate.memo === transfer.memo);
          const expectedDestination =
            payment === undefined ? undefined : await destinationFor(payment.payTo, account.mint);
          await withOrg(dbOf(deps), account.orgId, async (tx) => {
            if (
              payment !== undefined &&
              transfer.destination === expectedDestination &&
              transfer.amount === payment.amount &&
              payment.holdId !== null
            ) {
              await settle(tx, {
                orgId: account.orgId,
                holdId: payment.holdId,
                actualAmount: atomicToMicros(transfer.amount, account.decimals),
                meta: { txSignature: entry.signature },
              });
              await tx
                .update(schema.x402Payments)
                .set({ status: 'settled', txSignature: entry.signature, settledAt: new Date() })
                .where(eq(schema.x402Payments.id, payment.id));
              totals.settled += 1;
              return;
            }
            // X6: money left the budget account in a way Aperture did not authorize.
            await recordSpend(tx, {
              orgId: account.orgId,
              principalId: account.principalId,
              rail: 'x402',
              kind: 'unheld_capture',
              amount: atomicToMicros(transfer.amount, account.decimals),
              idempotencyKey: `x402-tx:${entry.signature}:${String(index)}`,
              externalRef: entry.signature,
              meta: { budgetAccount: account.budgetAccount, destination: transfer.destination, memo: transfer.memo },
            });
            totals.unknown += 1;
          });
          if (
            payment === undefined ||
            transfer.destination !== expectedDestination ||
            transfer.amount !== payment.amount
          ) {
            await queueAlert(deps, account.orgId, {
              dedupeKey: `x402-unknown:${entry.signature}:${String(index)}`,
              kind: 'x402_unknown_transfer',
              payload: {
                account: account.budgetAccount,
                signature: entry.signature,
                amount: transfer.amount.toString(),
              },
            });
          }
        }
      }
      const newest = signatures[0]?.signature;
      if (newest !== undefined) {
        await withOrg(dbOf(deps), account.orgId, (tx) =>
          tx.update(schema.x402Accounts).set({ cursor: newest }).where(eq(schema.x402Accounts.id, account.id)),
        );
      }

      // X4: a signed transaction whose blockhash has died can never land; release its hold.
      const height = await rpc.getBlockHeight();
      const stillSigned = await withOrg(dbOf(deps), account.orgId, (tx) =>
        tx
          .select()
          .from(schema.x402Payments)
          .where(and(eq(schema.x402Payments.accountId, account.id), eq(schema.x402Payments.status, 'signed'))),
      );
      for (const payment of stillSigned) {
        if (payment.lastValidBlockHeight === null || payment.lastValidBlockHeight + EXPIRY_MARGIN_BLOCKS >= height)
          continue;
        await withOrg(dbOf(deps), account.orgId, async (tx) => {
          if (payment.holdId !== null) await release(tx, { orgId: account.orgId, holdId: payment.holdId });
          await tx.update(schema.x402Payments).set({ status: 'expired' }).where(eq(schema.x402Payments.id, payment.id));
        });
        totals.expired += 1;
      }
    } catch (error) {
      deps.logger.warn({ err: error, account: account.id }, 'x402 watch failed for account');
    }
  }
  return totals;
}

/** Nightly: on-chain balance and allowance vs what Aperture thinks (X7, X8). */
export async function reconcileX402(deps: JobDeps): Promise<number> {
  const accounts = await withSystem(dbOf(deps), (tx) =>
    tx
      .select({ account: schema.x402Accounts, connection: schema.connections })
      .from(schema.x402Accounts)
      .innerJoin(schema.connections, eq(schema.connections.id, schema.x402Accounts.connectionId))
      .where(eq(schema.x402Accounts.status, 'active')),
  );
  let drifted = 0;
  for (const { account, connection } of accounts) {
    try {
      const state = await rpcForConnection(deps, connection).getTokenAccount(account.budgetAccount);
      const revoked = state?.delegate !== account.delegate;
      await withOrg(dbOf(deps), account.orgId, (tx) =>
        tx
          .update(schema.x402Accounts)
          .set({
            balance: state?.amount ?? 0n,
            allowance: revoked ? 0n : state.delegatedAmount,
            checkedAt: new Date(),
            ...(revoked ? { status: 'revoked' as const } : {}),
          })
          .where(eq(schema.x402Accounts.id, account.id)),
      );
      if (revoked) {
        drifted += 1;
        await queueAlert(deps, account.orgId, {
          dedupeKey: `x402-revoked:${account.id}`,
          kind: 'x402_allowance_revoked',
          payload: { account: account.budgetAccount },
        });
      }
    } catch (error) {
      deps.logger.warn({ err: error, account: account.id }, 'x402 reconcile failed for account');
    }
  }
  return drifted;
}

export async function syncStablePrices(deps: JobDeps): Promise<number> {
  const prices = await fetchStablecoinPrices(rpcFetch(deps));
  await withSystem(dbOf(deps), async (tx) => {
    for (const price of prices) {
      await tx
        .insert(schema.stablePrices)
        .values({ asset: price.asset, micros: price.micros, publishedAt: price.publishedAt })
        .onConflictDoUpdate({
          target: schema.stablePrices.asset,
          set: { micros: price.micros, publishedAt: price.publishedAt, updatedAt: new Date() },
        });
    }
  });
  return prices.length;
}

/**
 * Daily, for orgs that opted in (Solana connection `anchorAudit: true`): yesterday's audit
 * hashes → Merkle root → memo from the notary wallet. Needs NOTARY_SECRET_KEY.
 */
export async function anchorAudits(deps: JobDeps, now = new Date()): Promise<number> {
  if (deps.notarySecret === undefined) return 0;
  const notary = await notaryFromSecret(deps.notarySecret);
  const day = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const connections = await withSystem(dbOf(deps), (tx) =>
    tx
      .select()
      .from(schema.connections)
      .where(
        and(
          eq(schema.connections.provider, 'solana'),
          eq(schema.connections.status, 'active'),
          sql`(${schema.connections.config}->>'anchorAudit')::boolean is true`,
        ),
      ),
  );
  let anchored = 0;
  for (const connection of connections) {
    try {
      const done = await withOrg(dbOf(deps), connection.orgId, async (tx) => {
        const [existing] = await tx
          .select({ id: schema.auditAnchors.id })
          .from(schema.auditAnchors)
          .where(and(eq(schema.auditAnchors.orgId, connection.orgId), eq(schema.auditAnchors.day, day)));
        return existing !== undefined;
      });
      if (done) continue;
      const events = await withOrg(dbOf(deps), connection.orgId, (tx) =>
        tx
          .select({ hash: schema.auditEvents.hash })
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.orgId, connection.orgId),
              gte(schema.auditEvents.occurredAt, start),
              lt(schema.auditEvents.occurredAt, end),
            ),
          )
          .orderBy(asc(schema.auditEvents.seq)),
      );
      if (events.length === 0) continue;
      const root = merkleRoot(events.map((event) => event.hash));
      const rpc = rpcForConnection(deps, connection);
      const transaction = await buildMemoTransaction(
        notary,
        anchorMemo({ orgId: connection.orgId, day, root, events: events.length }),
        await rpc.getLatestBlockhash(),
      );
      const signature = await rpc.sendTransaction(transaction);
      await withOrg(dbOf(deps), connection.orgId, (tx) =>
        tx.insert(schema.auditAnchors).values({
          id: crypto.randomUUID(),
          orgId: connection.orgId,
          day,
          root,
          events: events.length,
          network: (connection.config as { network?: string }).network ?? 'devnet',
          signature,
        }),
      );
      anchored += 1;
    } catch (error) {
      deps.logger.warn({ err: error, org: connection.orgId }, 'audit anchoring failed');
    }
  }
  return anchored;
}
