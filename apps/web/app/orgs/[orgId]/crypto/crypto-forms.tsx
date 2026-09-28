'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Wallet } from '@wallet-standard/base';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input, Select } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api/browser';
import { explorerUrl, signAndSend, solanaWallets } from '@/lib/solana-wallet';
import { useSubmit } from '@/lib/use-submit';

type Network = 'devnet' | 'mainnet';

/** Picks an installed Wallet Standard wallet (Phantom, Solflare, …). */
function useWallet() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  useEffect(() => {
    setWallets(solanaWallets());
    const timer = setTimeout(() => {
      setWallets(solanaWallets());
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return wallets;
}

/** Runs "get a transaction from Aperture → sign in the wallet → sync from chain". */
function useTreasuryFlow(orgId: string, network: Network) {
  const router = useRouter();
  const wallets = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (treasury: string, getTransaction: () => Promise<{ transaction: string; accountId: string }>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const wallet = wallets[0];
      if (wallet === undefined) throw new Error('No Solana wallet found. Install Phantom or Solflare and reload.');
      const { transaction, accountId } = await getTransaction();
      const signature = await signAndSend(wallet, treasury, transaction, network);
      setDone(signature);
      // Give the chain a moment, then read the account back.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await api.POST('/api/v1/orgs/{orgId}/x402/accounts/{accountId}/sync', { params: { path: { orgId, accountId } } });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, done, walletName: wallets[0]?.name ?? null };
}

const orThrow = <T,>(result: { data?: T; error?: unknown }): T => {
  if (result.data === undefined) throw new Error(errorMessage(result.error));
  return result.data;
};

export function SolanaConnectForm({ orgId, connected }: { orgId: string; connected: boolean }) {
  const { submit, pending, error } = useSubmit();
  const [open, setOpen] = useState(!connected);
  const [network, setNetwork] = useState<Network>('devnet');
  const [treasury, setTreasury] = useState('');
  const [rpc, setRpc] = useState('');
  const [anchor, setAnchor] = useState(false);
  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Change connection
      </Button>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            api.PUT('/api/v1/orgs/{orgId}/x402/connection', {
              params: { path: { orgId } },
              body: {
                network,
                treasury,
                assets: ['USDC'],
                rpcUrls: rpc === '' ? [] : rpc.split(',').map((url) => url.trim()),
                trustOnFirstUse: true,
                anchorAudit: anchor,
              },
            }),
          () => {
            setOpen(false);
          },
        );
      }}
    >
      <Field label="Network" htmlFor="sol-network">
        <Select
          id="sol-network"
          value={network}
          onChange={(e) => {
            setNetwork(e.target.value as Network);
          }}
        >
          <option value="devnet">devnet (test)</option>
          <option value="mainnet">mainnet</option>
        </Select>
      </Field>
      <Field label="Treasury wallet address" htmlFor="sol-treasury">
        <Input
          id="sol-treasury"
          required
          className="font-mono"
          value={treasury}
          onChange={(e) => {
            setTreasury(e.target.value.trim());
          }}
        />
      </Field>
      <Field
        label="RPC URLs (optional)"
        htmlFor="sol-rpc"
        hint="Comma separated, primary first (e.g. Helius, then QuickNode). Stored encrypted."
      >
        <Input
          id="sol-rpc"
          value={rpc}
          onChange={(e) => {
            setRpc(e.target.value);
          }}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={anchor}
          onChange={(e) => {
            setAnchor(e.target.checked);
          }}
        />
        Anchor the audit log on Solana daily
      </label>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export function CreateAccountForm({
  orgId,
  network,
  treasury,
  agents,
}: {
  orgId: string;
  network: Network;
  treasury: string;
  agents: { id: string; name: string }[];
}) {
  const flow = useTreasuryFlow(orgId, network);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [float, setFloat] = useState('5');
  const [allowance, setAllowance] = useState('5');
  const [perPayment, setPerPayment] = useState('0.50');
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void flow.run(treasury, async () => {
          const created = orThrow(
            await api.POST('/api/v1/orgs/{orgId}/agents/{principalId}/x402/account', {
              params: { path: { orgId, principalId: agentId } },
              body: { asset: 'USDC', float, allowance, maxPerPayment: perPayment },
            }),
          );
          return { transaction: created.transaction, accountId: created.account.id };
        });
      }}
    >
      <Field label="Agent" htmlFor="x402-agent">
        <Select
          id="x402-agent"
          value={agentId}
          onChange={(e) => {
            setAgentId(e.target.value);
          }}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Float (USDC)" htmlFor="x402-float">
          <Input
            id="x402-float"
            value={float}
            onChange={(e) => {
              setFloat(e.target.value);
            }}
          />
        </Field>
        <Field label="Allowance" htmlFor="x402-allowance">
          <Input
            id="x402-allowance"
            value={allowance}
            onChange={(e) => {
              setAllowance(e.target.value);
            }}
          />
        </Field>
        <Field label="Per payment" htmlFor="x402-per">
          <Input
            id="x402-per"
            value={perPayment}
            onChange={(e) => {
              setPerPayment(e.target.value);
            }}
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        The allowance is the most this agent can ever spend on chain, even if Aperture were compromised. Your wallet
        {flow.walletName === null ? '' : ` (${flow.walletName})`} will ask you to sign.
      </p>
      <FormError message={flow.error} />
      {flow.done === null ? null : (
        <FormNotice>
          Sent.{' '}
          <a className="underline" href={explorerUrl(flow.done, network)} target="_blank" rel="noreferrer">
            View on explorer
          </a>
        </FormNotice>
      )}
      <Button type="submit" className="w-full" disabled={flow.busy || agentId === ''}>
        Create and sign in wallet
      </Button>
    </form>
  );
}

export function AccountActions({
  orgId,
  account,
  network,
}: {
  orgId: string;
  account: { id: string; treasury: string; allowance: string };
  network: Network;
}) {
  const flow = useTreasuryFlow(orgId, network);
  const { submit, pending } = useSubmit();
  const [add, setAdd] = useState('0');
  const [allowance, setAllowance] = useState(account.allowance);
  const params = { params: { path: { orgId, accountId: account.id } } };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          submit(() => api.POST('/api/v1/orgs/{orgId}/x402/accounts/{accountId}/sync', params));
        }}
      >
        Refresh from chain
      </Button>
      <Input
        aria-label="Add float"
        className="h-8 w-20 text-sm"
        value={add}
        onChange={(e) => {
          setAdd(e.target.value);
        }}
      />
      <Input
        aria-label="New allowance"
        className="h-8 w-24 text-sm"
        value={allowance}
        onChange={(e) => {
          setAllowance(e.target.value);
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={flow.busy}
        onClick={() => {
          void flow.run(account.treasury, async () => ({
            transaction: orThrow(
              await api.POST('/api/v1/orgs/{orgId}/x402/accounts/{accountId}/top-up', {
                ...params,
                body: { add, allowance },
              }),
            ).transaction,
            accountId: account.id,
          }));
        }}
      >
        Top up
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={flow.busy}
        onClick={() => {
          void flow.run(account.treasury, async () => ({
            transaction: orThrow(
              await api.POST('/api/v1/orgs/{orgId}/x402/accounts/{accountId}/revoke', {
                ...params,
                body: { sweep: true },
              }),
            ).transaction,
            accountId: account.id,
          }));
        }}
      >
        Revoke and sweep
      </Button>
      <FormError message={flow.error} />
    </div>
  );
}

export function ApprovePayee({ orgId, payeeId }: { orgId: string; payeeId: string }) {
  const { submit, pending, error } = useSubmit();
  return (
    <span className="flex items-center gap-2">
      <FormError message={error} />
      <Button
        size="sm"
        disabled={pending}
        onClick={() => {
          submit(() =>
            api.POST('/api/v1/orgs/{orgId}/x402/payees/{payeeId}/approve', { params: { path: { orgId, payeeId } } }),
          );
        }}
      >
        Approve
      </Button>
    </span>
  );
}
