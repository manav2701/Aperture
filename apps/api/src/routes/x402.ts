import { formatUsd, micros, parseUsd } from '@aperture/core';
import { encryptSecret } from '@aperture/crypto';
import { and, appendAuditEvent, desc, eq, schema, withOrg } from '@aperture/db';
import { rpcForConnection } from '@aperture/jobs';
import {
  ASSETS,
  TOKEN_ACCOUNT_SPACE,
  budgetAccountAddress,
  buildRevokeTransaction,
  buildSetupTransaction,
  buildTopUpTransaction,
  type SolanaNetwork,
} from '@aperture/x402';
import { createRoute, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { requireUser, type Router } from '../http/access';
import { auditByUser } from '../http/audit';
import type { AppDeps } from '../http/context';
import { AppError, notFound } from '../http/errors';
import { OrgParams, Timestamp, UsdSchema, errorResponses, json, jsonBody } from '../http/schemas';

/*
 * The crypto rail in the dashboard (plan/phases/phase-09 §9.1): connect a Solana network and the
 * treasury wallet (public key only), give agents budget accounts with an on-chain allowance,
 * top up or revoke them, approve payee changes, and see payments and audit anchors. Every
 * transaction that moves treasury funds is returned unsigned for the treasury wallet to sign.
 */

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'a Solana address');
const ACCOUNT_STATUSES = ['pending_setup', 'active', 'revoked'] as const;

const AccountSchema = z
  .object({
    id: z.uuid(),
    principal: z.object({ id: z.uuid(), name: z.string() }),
    network: z.string(),
    asset: z.string(),
    treasury: z.string(),
    budgetAccount: z.string(),
    delegate: z.string().nullable(),
    allowance: UsdSchema,
    balance: UsdSchema,
    maxPerPayment: UsdSchema,
    status: z.enum(ACCOUNT_STATUSES),
    checkedAt: Timestamp.nullable(),
  })
  .openapi('X402Account');

const TxSchema = z.object({
  transaction: z.string().openapi({ description: 'base64 unsigned transaction for the treasury wallet' }),
});
const AccountParams = OrgParams.extend({ accountId: z.uuid().openapi({ param: { name: 'accountId', in: 'path' } }) });
const atomicToUsd = (amount: bigint) => formatUsd(micros(amount));

type Account = typeof schema.x402Accounts.$inferSelect;

const view = (account: Account, principalName: string): z.infer<typeof AccountSchema> => ({
  id: account.id,
  principal: { id: account.principalId, name: principalName },
  network: account.network,
  asset: account.asset,
  treasury: account.treasury,
  budgetAccount: account.budgetAccount,
  delegate: account.delegate,
  allowance: atomicToUsd(account.allowance),
  balance: atomicToUsd(account.balance),
  maxPerPayment: atomicToUsd(account.maxPerPayment),
  status: account.status,
  checkedAt: account.checkedAt?.toISOString() ?? null,
});

export function registerX402Routes(router: Router, deps: AppDeps): void {
  const solanaConnection = (orgId: string) =>
    withOrg(deps.db, orgId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.connections)
        .where(
          and(
            eq(schema.connections.orgId, orgId),
            eq(schema.connections.provider, 'solana'),
            eq(schema.connections.status, 'active'),
          ),
        );
      return row;
    });

  router.add(
    { permission: 'connections.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/x402/connection',
      tags: ['x402'],
      summary: 'The Solana connection: network, treasury wallet, assets, payee and anchoring settings',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            connected: z.boolean(),
            network: z.string().nullable(),
            treasury: z.string().nullable(),
            assets: z.array(z.string()),
            trustOnFirstUse: z.boolean(),
            anchorAudit: z.boolean(),
            customRpc: z.boolean(),
            signerAvailable: z.boolean(),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const connection = await solanaConnection(orgId);
      const config = (connection?.config ?? {}) as Record<string, unknown>;
      return c.json(
        {
          connected: connection !== undefined,
          network: typeof config.network === 'string' ? config.network : null,
          treasury: typeof config.treasury === 'string' ? config.treasury : null,
          assets: Array.isArray(config.assets) ? config.assets.map(String) : [],
          trustOnFirstUse: config.trustOnFirstUse !== false,
          anchorAudit: config.anchorAudit === true,
          customRpc: config.customRpc === true,
          signerAvailable: deps.signer !== undefined,
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'connections.manage' },
    createRoute({
      method: 'put',
      path: '/api/v1/orgs/{orgId}/x402/connection',
      tags: ['x402'],
      summary: 'Connect Solana: network, the treasury wallet’s public key, and optional RPC providers',
      description:
        'Mainnet is refused until MAINNET_X402_ENABLED is set on the server (the legal opinion, C1). RPC URLs may contain API keys and are stored encrypted.',
      request: {
        params: OrgParams,
        ...jsonBody(
          z.object({
            network: z.enum(['devnet', 'mainnet']),
            treasury: base58,
            assets: z
              .array(z.enum(['USDC', 'USDT']))
              .min(1)
              .default(['USDC']),
            rpcUrls: z.array(z.url().startsWith('https://')).max(3).default([]),
            trustOnFirstUse: z.boolean().default(true),
            anchorAudit: z.boolean().default(false),
          }),
        ),
      },
      responses: { 204: { description: 'Saved' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId } = c.req.valid('param');
      const body = c.req.valid('json');
      if (body.network === 'mainnet' && !deps.mainnetX402) {
        throw new AppError(400, 'mainnet_disabled', 'mainnet payments are not enabled on this deployment yet');
      }
      const assets = body.assets.filter((asset) => ASSETS[body.network].some((known) => known.asset === asset));
      if (assets.length === 0) throw new AppError(400, 'no_assets', `none of those assets exist on ${body.network}`);
      await withOrg(deps.db, orgId, async (tx) => {
        await tx
          .update(schema.connections)
          .set({ status: 'disabled' })
          .where(and(eq(schema.connections.orgId, orgId), eq(schema.connections.provider, 'solana')));
        const id = uuidv7();
        await tx.insert(schema.connections).values({
          id,
          orgId,
          provider: 'solana',
          name: `Solana (${body.network})`,
          fingerprint: `${body.network}:${body.treasury}:${id}`,
          secret: encryptSecret(JSON.stringify({ rpcUrls: body.rpcUrls }), `${orgId}|${id}`, deps.ring),
          config: {
            network: body.network,
            treasury: body.treasury,
            assets,
            trustOnFirstUse: body.trustOnFirstUse,
            anchorAudit: body.anchorAudit,
            customRpc: body.rpcUrls.length > 0,
          },
        });
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'x402.connected',
          subject: `connection:${id}`,
          data: { network: body.network, treasury: body.treasury, assets },
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'agents.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/x402/accounts',
      tags: ['x402'],
      summary: 'Agents’ budget accounts with the last on-chain balance and allowance',
      request: { params: OrgParams },
      responses: { 200: json(z.object({ accounts: z.array(AccountSchema) })), ...errorResponses },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ account: schema.x402Accounts, name: schema.principals.name })
          .from(schema.x402Accounts)
          .innerJoin(schema.principals, eq(schema.principals.id, schema.x402Accounts.principalId))
          .where(eq(schema.x402Accounts.orgId, orgId))
          .orderBy(desc(schema.x402Accounts.createdAt)),
      );
      return c.json({ accounts: rows.map((row) => view(row.account, row.name)) }, 200);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/agents/{principalId}/x402/account',
      tags: ['x402'],
      summary: 'Create an agent budget account; returns the setup transaction for the treasury wallet to sign',
      description:
        'The allowance is the most this agent can ever spend on chain, even if Aperture were compromised: size it as the maximum acceptable loss.',
      request: {
        params: OrgParams.extend({ principalId: z.uuid().openapi({ param: { name: 'principalId', in: 'path' } }) }),
        ...jsonBody(
          z.object({
            asset: z.enum(['USDC', 'USDT']).default('USDC'),
            float: UsdSchema,
            allowance: UsdSchema,
            maxPerPayment: UsdSchema.default('1'),
          }),
        ),
      },
      responses: {
        201: json(z.object({ account: AccountSchema, ...TxSchema.shape }), 'Created'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, principalId } = c.req.valid('param');
      const body = c.req.valid('json');
      const signer = deps.signer;
      if (signer === undefined) throw new AppError(503, 'signer_unavailable', 'the x402 signer is not configured');
      const connection = await solanaConnection(orgId);
      if (connection === undefined) throw new AppError(409, 'not_connected', 'connect Solana first');
      const config = connection.config as { network: SolanaNetwork; treasury: string; assets?: string[] };
      const asset = ASSETS[config.network].find((known) => known.asset === body.asset);
      if (asset === undefined || !(config.assets ?? ['USDC']).includes(body.asset)) {
        throw new AppError(400, 'asset_not_enabled', `${body.asset} is not enabled for this connection`);
      }
      const [principal] = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.principals)
          .where(and(eq(schema.principals.id, principalId), eq(schema.principals.orgId, orgId))),
      );
      if (principal?.kind !== 'agent') throw notFound('agent');

      const budgetAccount = await budgetAccountAddress(config.treasury, principalId, asset.mint);
      const accountId = uuidv7();
      const inserted = await withOrg(deps.db, orgId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.x402Accounts)
          .where(and(eq(schema.x402Accounts.orgId, orgId), eq(schema.x402Accounts.budgetAccount, budgetAccount)));
        if (existing !== undefined && existing.status !== 'pending_setup') {
          throw new AppError(
            409,
            'account_exists',
            'this agent already has a budget account for that asset; top it up instead',
          );
        }
        if (existing !== undefined) return existing;
        const [row] = await tx
          .insert(schema.x402Accounts)
          .values({
            id: accountId,
            orgId,
            principalId,
            connectionId: connection.id,
            network: config.network,
            asset: asset.asset,
            mint: asset.mint,
            decimals: asset.decimals,
            treasury: config.treasury,
            budgetAccount,
            maxPerPayment: parseUsd(body.maxPerPayment),
          })
          .returning();
        if (!row) throw new Error('insert returned no row');
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'x402.account.created',
          subject: `x402_account:${row.id}`,
          data: { principalId, budgetAccount, allowance: body.allowance, float: body.float },
        });
        return row;
      });
      const delegate = await signer.createKey(orgId, inserted.id);
      const rpc = rpcForConnection(deps.jobs, connection);
      const [lifetime, rent] = await Promise.all([
        rpc.getLatestBlockhash(),
        rpc.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE),
      ]);
      const setup = await buildSetupTransaction(
        {
          treasury: config.treasury,
          principalId,
          mint: asset.mint,
          decimals: asset.decimals,
          delegate,
          float: parseUsd(body.float),
          allowance: parseUsd(body.allowance),
          rentLamports: rent,
        },
        lifetime,
      );
      return c.json({ account: view({ ...inserted, delegate }, principal.name), transaction: setup.transaction }, 201);
    },
  );

  const loadAccount = async (orgId: string, accountId: string) => {
    const [row] = await withOrg(deps.db, orgId, (tx) =>
      tx
        .select({ account: schema.x402Accounts, name: schema.principals.name, connection: schema.connections })
        .from(schema.x402Accounts)
        .innerJoin(schema.principals, eq(schema.principals.id, schema.x402Accounts.principalId))
        .innerJoin(schema.connections, eq(schema.connections.id, schema.x402Accounts.connectionId))
        .where(and(eq(schema.x402Accounts.id, accountId), eq(schema.x402Accounts.orgId, orgId))),
    );
    if (row === undefined) throw notFound('budget account');
    return row;
  };

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/x402/accounts/{accountId}/sync',
      tags: ['x402'],
      summary: 'Read the budget account from chain (after the treasury signed) and activate or update it',
      request: { params: AccountParams },
      responses: { 200: json(AccountSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, accountId } = c.req.valid('param');
      const { account, name, connection } = await loadAccount(orgId, accountId);
      const state = await rpcForConnection(deps.jobs, connection).getTokenAccount(account.budgetAccount);
      const delegated = state !== null && state.delegate === account.delegate && state.mint === account.mint;
      const status =
        delegated && state.delegatedAmount > 0n
          ? 'active'
          : account.status === 'pending_setup'
            ? 'pending_setup'
            : 'revoked';
      const [updated] = await withOrg(deps.db, orgId, async (tx) => {
        const rows = await tx
          .update(schema.x402Accounts)
          .set({
            status,
            balance: state?.amount ?? 0n,
            allowance: delegated ? state.delegatedAmount : 0n,
            checkedAt: new Date(),
          })
          .where(eq(schema.x402Accounts.id, accountId))
          .returning();
        if (status !== account.status) {
          await auditByUser(tx, {
            orgId,
            userId: user.id,
            action: `x402.account.${status === 'active' ? 'activated' : status}`,
            subject: `x402_account:${accountId}`,
            data: { allowance: delegated ? state.delegatedAmount.toString() : '0' },
          });
        }
        return rows;
      });
      if (updated === undefined) throw notFound('budget account');
      return c.json(view(updated, name), 200);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/x402/accounts/{accountId}/top-up',
      tags: ['x402'],
      summary: 'Add float and/or set a new allowance; returns the transaction for the treasury wallet',
      request: { params: AccountParams, ...jsonBody(z.object({ add: UsdSchema.default('0'), allowance: UsdSchema })) },
      responses: { 200: json(TxSchema), ...errorResponses },
    }),
    async (c) => {
      const { orgId, accountId } = c.req.valid('param');
      const body = c.req.valid('json');
      const { account, connection } = await loadAccount(orgId, accountId);
      if (account.delegate === null) throw new AppError(409, 'no_delegate', 'the account has no delegate key yet');
      const transaction = await buildTopUpTransaction(
        {
          treasury: account.treasury,
          budgetAccount: account.budgetAccount,
          mint: account.mint,
          decimals: account.decimals,
          delegate: account.delegate,
          add: parseUsd(body.add),
          allowance: parseUsd(body.allowance),
        },
        await rpcForConnection(deps.jobs, connection).getLatestBlockhash(),
      );
      return c.json({ transaction }, 200);
    },
  );

  router.add(
    { permission: 'agents.manage' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/x402/accounts/{accountId}/revoke',
      tags: ['x402'],
      summary: 'Revoke the agent’s allowance (and optionally sweep the float back); returns the transaction to sign',
      description: 'Aperture stops signing at once; the chain enforces it once the treasury signs.',
      request: { params: AccountParams, ...jsonBody(z.object({ sweep: z.boolean().default(true) })) },
      responses: { 200: json(TxSchema), ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, accountId } = c.req.valid('param');
      const body = c.req.valid('json');
      const { account, connection } = await loadAccount(orgId, accountId);
      const rpc = rpcForConnection(deps.jobs, connection);
      const state = body.sweep ? await rpc.getTokenAccount(account.budgetAccount) : null;
      const transaction = await buildRevokeTransaction(
        {
          treasury: account.treasury,
          budgetAccount: account.budgetAccount,
          mint: account.mint,
          decimals: account.decimals,
          sweep: state?.amount ?? 0n,
        },
        await rpc.getLatestBlockhash(),
      );
      await withOrg(deps.db, orgId, async (tx) => {
        await tx
          .update(schema.x402Accounts)
          .set({ status: 'revoked', allowance: 0n })
          .where(eq(schema.x402Accounts.id, accountId));
        await auditByUser(tx, {
          orgId,
          userId: user.id,
          action: 'x402.account.revoked',
          subject: `x402_account:${accountId}`,
        });
      });
      return c.json({ transaction }, 200);
    },
  );

  router.add(
    { permission: 'approvals.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/x402/payees',
      tags: ['x402'],
      summary: 'Which payTo address each paid origin is bound to, and changes waiting for a person (X1)',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            payees: z.array(
              z.object({
                id: z.uuid(),
                origin: z.string(),
                payTo: z.string(),
                network: z.string(),
                status: z.enum(['active', 'pending']),
                createdAt: Timestamp,
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.x402Payees)
          .where(eq(schema.x402Payees.orgId, orgId))
          .orderBy(desc(schema.x402Payees.createdAt)),
      );
      return c.json(
        {
          payees: rows.map((row) => ({
            id: row.id,
            origin: row.origin,
            payTo: row.payTo,
            network: row.network,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'approvals.decide' },
    createRoute({
      method: 'post',
      path: '/api/v1/orgs/{orgId}/x402/payees/{payeeId}/approve',
      tags: ['x402'],
      summary: 'Approve a payee (new, or a changed payTo): it becomes the only active one for its origin',
      request: { params: OrgParams.extend({ payeeId: z.uuid().openapi({ param: { name: 'payeeId', in: 'path' } }) }) },
      responses: { 204: { description: 'Approved' }, ...errorResponses },
    }),
    async (c) => {
      const user = requireUser(c);
      const { orgId, payeeId } = c.req.valid('param');
      await withOrg(deps.db, orgId, async (tx) => {
        const [payee] = await tx
          .select()
          .from(schema.x402Payees)
          .where(and(eq(schema.x402Payees.id, payeeId), eq(schema.x402Payees.orgId, orgId)));
        if (!payee) throw notFound('payee');
        await tx
          .update(schema.x402Payees)
          .set({ status: 'pending' })
          .where(and(eq(schema.x402Payees.orgId, orgId), eq(schema.x402Payees.origin, payee.origin)));
        await tx
          .update(schema.x402Payees)
          .set({ status: 'active', approvedBy: user.id })
          .where(eq(schema.x402Payees.id, payeeId));
        await appendAuditEvent(tx, orgId, {
          actor: `user:${user.id}`,
          action: 'x402.payee.approved',
          subject: `payee:${payee.origin}`,
          data: { payTo: payee.payTo },
        });
      });
      return c.body(null, 204);
    },
  );

  router.add(
    { permission: 'spend.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/x402/payments',
      tags: ['x402'],
      summary: 'Recent x402 payments with their on-chain signature and delivery status',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            payments: z.array(
              z.object({
                id: z.uuid(),
                principalId: z.uuid(),
                origin: z.string(),
                payTo: z.string(),
                amount: UsdSchema,
                status: z.string(),
                txSignature: z.string().nullable(),
                deliveredStatus: z.number().nullable(),
                network: z.string(),
                createdAt: Timestamp,
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({
            payment: schema.x402Payments,
            network: schema.x402Accounts.network,
            decimals: schema.x402Accounts.decimals,
          })
          .from(schema.x402Payments)
          .innerJoin(schema.x402Accounts, eq(schema.x402Accounts.id, schema.x402Payments.accountId))
          .where(eq(schema.x402Payments.orgId, orgId))
          .orderBy(desc(schema.x402Payments.createdAt))
          .limit(200),
      );
      return c.json(
        {
          payments: rows.map(({ payment, network }) => ({
            id: payment.id,
            principalId: payment.principalId,
            origin: payment.origin,
            payTo: payment.payTo,
            amount: atomicToUsd(payment.amount),
            status: payment.status,
            txSignature: payment.txSignature,
            deliveredStatus: payment.deliveredStatus,
            network,
            createdAt: payment.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  router.add(
    { permission: 'audit.read' },
    createRoute({
      method: 'get',
      path: '/api/v1/orgs/{orgId}/audit/anchors',
      tags: ['audit'],
      summary: 'Daily audit roots written to Solana (verify with pnpm audit-verify --check-anchor)',
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            anchors: z.array(
              z.object({
                day: z.string(),
                root: z.string(),
                events: z.number(),
                network: z.string(),
                signature: z.string(),
              }),
            ),
          }),
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid('param');
      const rows = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select()
          .from(schema.auditAnchors)
          .where(eq(schema.auditAnchors.orgId, orgId))
          .orderBy(desc(schema.auditAnchors.day))
          .limit(90),
      );
      return c.json(
        {
          anchors: rows.map((row) => ({
            day: row.day,
            root: row.root,
            events: row.events,
            network: row.network,
            signature: row.signature,
          })),
        },
        200,
      );
    },
  );
}
