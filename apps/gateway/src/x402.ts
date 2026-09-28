import { micros } from '@aperture/core';
import { and, appendAuditEvent, eq, release, schema, withOrg } from '@aperture/db';
import {
  CAIP2,
  X402Error,
  acceptRequirement,
  assetsFor,
  atomicToMicros,
  decodePaymentRequired,
  depegReason,
  encodePaymentSignature,
  type SolanaNetwork,
} from '@aperture/x402';
import type { Hono } from 'hono';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { decide, reserveWithAuthority, resolveAuthority } from './authority';
import { loadPrincipalContext, type Caller } from './context';
import { GatewayError, errorResponse } from './errors';
import { admit, type GatewayDeps } from './pipeline';

/*
 * x402 payments (plan/phases/phase-09 §9.3). The agent hands us a seller's 402; we check it,
 * bind the payee, run policy/approvals and the budget, hold the money, and have the signer sign
 * the transfer as the agent's delegate. The agent sends the result as `PAYMENT-SIGNATURE`.
 * Nothing here holds a key; nothing leaves without an open hold.
 */

export interface SignerClient {
  sign(orgId: string, paymentId: string): Promise<{ transaction: string; lastValidBlockHeight: bigint }>;
  createKey(orgId: string, accountId: string): Promise<string>;
}

export class SignerUnavailable extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SignerUnavailable';
    this.code = code;
  }
}

/** The signer over its private HTTP interface. */
export function httpSigner(baseUrl: string, sharedSecret: string, fetchImpl: typeof fetch = fetch): SignerClient {
  const call = async (path: string, body: Record<string, string>) => {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sharedSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new SignerUnavailable(
        typeof json.error === 'string' ? json.error : 'signer_error',
        typeof json.message === 'string' ? json.message : 'the signer refused',
      );
    }
    return json;
  };
  return {
    async sign(orgId, paymentId) {
      const json = await call('/v1/sign', { orgId, paymentId });
      return { transaction: String(json.transaction), lastValidBlockHeight: BigInt(String(json.lastValidBlockHeight)) };
    },
    async createKey(orgId, accountId) {
      return String((await call('/v1/keys', { orgId, accountId })).delegate);
    },
  };
}

const authorizeBody = z.object({
  url: z.url().max(2000),
  paymentRequired: z.unknown(),
  selectedIndex: z.number().int().min(0).max(19).optional(),
  purpose: z.string().max(500).optional(),
});

interface SolanaConfig {
  network?: SolanaNetwork;
  trustOnFirstUse?: boolean;
}

/** X1: an origin keeps the payTo it first used; a different one waits for a person. */
async function checkPayee(
  deps: GatewayDeps,
  caller: Caller,
  input: { origin: string; payTo: string; network: string; trustOnFirstUse: boolean },
) {
  return withOrg(deps.db, caller.orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.x402Payees)
      .where(and(eq(schema.x402Payees.orgId, caller.orgId), eq(schema.x402Payees.origin, input.origin)));
    const exact = rows.find((row) => row.payTo === input.payTo);
    if (exact?.status === 'active') return;
    if (exact?.status === 'pending') {
      throw new GatewayError(
        'aperture_policy_denied',
        `the payee ${input.payTo} for ${input.origin} is waiting for approval`,
        {
          reason: 'payee_pending',
        },
      );
    }
    const bound = rows.find((row) => row.status === 'active');
    const firstUse = bound === undefined && input.trustOnFirstUse;
    await tx.insert(schema.x402Payees).values({
      id: uuidv7(),
      orgId: caller.orgId,
      origin: input.origin,
      payTo: input.payTo,
      network: input.network,
      status: firstUse ? 'active' : 'pending',
    });
    await appendAuditEvent(tx, caller.orgId, {
      actor: `agent:${caller.principalId}`,
      action: firstUse ? 'x402.payee.bound' : 'x402.payee.change_requested',
      subject: `payee:${input.origin}`,
      data: { payTo: input.payTo, previous: bound?.payTo ?? null },
    });
    if (firstUse) return;
    // Throwing would roll back the pending row a person needs to see; return the refusal instead.
    return new GatewayError(
      'aperture_policy_denied',
      bound === undefined
        ? `new payee ${input.payTo} for ${input.origin} needs approval (Crypto → Payees)`
        : `${input.origin} asked to be paid at ${input.payTo}, not its bound ${bound.payTo}; a person must approve the change`,
      { reason: bound === undefined ? 'payee_pending' : 'payee_mismatch' },
    );
  });
}

export function registerX402Routes(app: Hono, deps: GatewayDeps): void {
  app.post('/v1/x402/authorize', async (c) => {
    const requestId = uuidv7();
    const admitted = await admit(deps, c.req.raw, 'openai', requestId);
    if (admitted instanceof Response) return admitted;
    const { caller, releaseSlot } = admitted;
    try {
      const parsed = authorizeBody.safeParse(admitted.body);
      if (!parsed.success) throw new GatewayError('aperture_invalid_request', 'expected { url, paymentRequired }');
      const body = parsed.data;
      if (deps.signer === undefined)
        throw new GatewayError('aperture_unavailable', 'x402 payments are not enabled here');

      const found = await withOrg(deps.db, caller.orgId, async (tx) => {
        const [row] = await tx
          .select({ account: schema.x402Accounts, connection: schema.connections })
          .from(schema.x402Accounts)
          .innerJoin(schema.connections, eq(schema.connections.id, schema.x402Accounts.connectionId))
          .where(
            and(eq(schema.x402Accounts.principalId, caller.principalId), eq(schema.x402Accounts.status, 'active')),
          );
        return row;
      });
      if (found === undefined) {
        throw new GatewayError('aperture_policy_denied', 'this agent has no active x402 budget account', {
          reason: 'no_budget_account',
        });
      }
      const { account, connection } = found;
      if (connection.status !== 'active')
        throw new GatewayError('aperture_policy_denied', 'the Solana connection is disabled');
      const network = account.network as SolanaNetwork;
      const config = connection.config as SolanaConfig;

      let accepted;
      try {
        accepted = acceptRequirement(
          decodePaymentRequired(body.paymentRequired),
          { network, assets: assetsFor(network, [account.asset]), maxAtomic: account.maxPerPayment },
          body.selectedIndex,
        );
      } catch (error) {
        if (error instanceof X402Error)
          throw new GatewayError('aperture_policy_denied', error.message, { reason: error.code });
        throw error;
      }

      // X13: on mainnet, a stablecoin off its peg (or with no fresh price) is not spent.
      if (network === 'mainnet') {
        const [price] = await withOrg(deps.db, caller.orgId, (tx) =>
          tx.select().from(schema.stablePrices).where(eq(schema.stablePrices.asset, account.asset)),
        );
        const reason = depegReason(price);
        if (reason !== undefined)
          throw new GatewayError('aperture_policy_denied', reason, { reason: 'asset_depegged' });
      }

      const origin = new URL(body.url).origin;
      const refusal = await checkPayee(deps, caller, {
        origin,
        payTo: accepted.payTo,
        network: CAIP2[network],
        trustOnFirstUse: config.trustOnFirstUse !== false,
      });
      if (refusal !== undefined) throw refusal;

      const amountMicros = atomicToMicros(accepted.amount, accepted.asset.decimals);
      const resource = `x402:${origin}`;
      const authority = await resolveAuthority(deps, caller, c.req.raw, { rail: 'x402', resource });
      const context = await loadPrincipalContext(deps.db, deps.cache, caller);
      await decide(deps, caller, authority, {
        action: {
          rail: 'x402',
          amount: micros(amountMicros),
          payee: { origin, payTo: accepted.payTo, network: CAIP2[network], asset: accepted.asset.mint },
        },
        context,
        resource,
        purpose: body.purpose ?? `x402 payment to ${origin}`,
        route: '/v1/x402/authorize',
      });

      const paymentId = uuidv7();
      const reservation = await reserveWithAuthority(deps, caller, authority, {
        orgId: caller.orgId,
        principalId: caller.principalId,
        rail: 'x402',
        amount: amountMicros,
        idempotencyKey: `x402:${c.req.header('idempotency-key') ?? paymentId}`,
        ttlSeconds: 60 * 60,
        onExpiry: 'reconcile',
        resource,
        externalRef: paymentId,
        meta: { paymentId, origin, payTo: accepted.payTo, network },
      });
      if (!reservation.ok) {
        throw reservation.reason === 'budget_exceeded'
          ? new GatewayError(
              'aperture_budget_exceeded',
              `budget "${reservation.budgetName}" can't cover this payment`,
              {
                budget: reservation.budgetName,
              },
            )
          : reservation.reason === 'principal_inactive'
            ? new GatewayError('aperture_principal_inactive', 'this agent is paused or revoked')
            : new GatewayError('aperture_no_budget', 'no budget covers this agent');
      }
      const holdId = reservation.hold.id;
      await withOrg(deps.db, caller.orgId, (tx) =>
        tx.insert(schema.x402Payments).values({
          id: paymentId,
          orgId: caller.orgId,
          principalId: caller.principalId,
          accountId: account.id,
          holdId,
          url: body.url,
          origin,
          payTo: accepted.payTo,
          feePayer: accepted.feePayer,
          amount: accepted.amount,
          memo: `aperture:${paymentId.replace(/-/g, '')}`,
          requirement: accepted.requirement,
        }),
      );

      let signed;
      try {
        signed = await deps.signer.sign(caller.orgId, paymentId);
      } catch (error) {
        // Nothing was signed: give the money back and say why.
        await withOrg(deps.db, caller.orgId, async (tx) => {
          await release(tx, { orgId: caller.orgId, holdId });
          await tx
            .update(schema.x402Payments)
            .set({ status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'signer error' })
            .where(eq(schema.x402Payments.id, paymentId));
        });
        if (error instanceof SignerUnavailable) {
          throw new GatewayError('aperture_policy_denied', `not signed: ${error.message}`, { reason: error.code });
        }
        throw new GatewayError('aperture_unavailable', 'the signer is unavailable; nothing was paid');
      }
      return c.json({
        payment_id: paymentId,
        payment_signature: encodePaymentSignature({
          resourceUrl: body.url,
          accepted: accepted.requirement,
          transaction: signed.transaction,
        }),
        amount_usd: (Number(amountMicros) / 1_000_000).toFixed(6),
        pay_to: accepted.payTo,
        network: CAIP2[network],
        last_valid_block_height: signed.lastValidBlockHeight.toString(),
      });
    } catch (error) {
      if (error instanceof GatewayError) return errorResponse(error, 'openai', requestId);
      deps.logger.error({ err: error, requestId }, 'x402 authorize failed');
      return errorResponse(
        new GatewayError('aperture_unavailable', 'Aperture is temporarily unavailable; nothing was paid'),
        'openai',
        requestId,
      );
    } finally {
      releaseSlot();
    }
  });

  // Delivery tracking (X5): the SDK reports what the paid resource answered.
  app.post('/v1/x402/payments/:id/delivered', async (c) => {
    const requestId = uuidv7();
    const admitted = await admit(deps, c.req.raw, 'openai', requestId);
    if (admitted instanceof Response) return admitted;
    const { caller, releaseSlot } = admitted;
    try {
      const status = z.object({ status: z.number().int().min(100).max(599) }).safeParse(admitted.body);
      const id = c.req.param('id');
      if (!status.success || !/^[0-9a-f-]{36}$/i.test(id))
        throw new GatewayError('aperture_invalid_request', 'expected { status }');
      const updated = await withOrg(deps.db, caller.orgId, (tx) =>
        tx
          .update(schema.x402Payments)
          .set({ deliveredStatus: status.data.status })
          .where(and(eq(schema.x402Payments.id, id), eq(schema.x402Payments.principalId, caller.principalId)))
          .returning({ id: schema.x402Payments.id }),
      );
      if (updated.length === 0) throw new GatewayError('aperture_invalid_request', 'no such payment for this agent');
      return c.json({ recorded: true });
    } catch (error) {
      if (error instanceof GatewayError) return errorResponse(error, 'openai', requestId);
      throw error;
    } finally {
      releaseSlot();
    }
  });
}
