import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { explorerUrl } from '@/lib/solana-wallet';
import { AccountActions, ApprovePayee, CreateAccountForm, SolanaConnectForm } from './crypto-forms';

export default async function CryptoPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, connection, { accounts }, { payees }, { payments }, { agents }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/x402/connection', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/x402/accounts', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/x402/payees', path).then((r) => r.data ?? { payees: [] }),
    api.GET('/api/v1/orgs/{orgId}/x402/payments', path).then((r) => r.data ?? { payments: [] }),
    api.GET('/api/v1/orgs/{orgId}/agents', path).then(unwrap),
  ]);
  const manageAgents = can(org.role, 'agents.manage');
  const decide = can(org.role, 'approvals.decide');
  const network = connection.network === 'mainnet' ? 'mainnet' : 'devnet';

  return (
    <>
      <PageHeader
        title="Crypto payments"
        description="Agents pay x402 APIs in USDC on Solana from budget accounts your treasury wallet owns. Each agent can spend at most its on-chain allowance; Aperture checks budgets, policies and payees before every signature."
      />
      <div className="grid gap-8 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          <Card>
            <CardTitle>Agent budget accounts</CardTitle>
            {accounts.length === 0 ? (
              <EmptyState>No budget accounts yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {accounts.map((account) => (
                  <li key={account.id} className="space-y-2 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="space-x-2">
                        <span className="font-medium">{account.principal.name}</span>
                        <Badge tone={account.status === 'active' ? 'accent' : 'danger'}>{account.status}</Badge>
                        <Badge>{account.asset}</Badge>
                      </span>
                      <span className="font-mono text-xs">
                        balance ${account.balance} · allowance ${account.allowance} · per payment ≤ $
                        {account.maxPerPayment}
                      </span>
                    </div>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      account {account.budgetAccount} · delegate {account.delegate ?? '—'}
                      {account.checkedAt === null
                        ? ''
                        : ` · checked ${formatDateTime(account.checkedAt, org.timezone)}`}
                    </p>
                    {manageAgents && account.status !== 'revoked' ? (
                      <AccountActions orgId={orgId} account={account} network={network} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Payments</CardTitle>
            {payments.length === 0 ? (
              <EmptyState>No payments yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="space-x-2">
                      <Badge tone={payment.status === 'settled' || payment.status === 'signed' ? 'accent' : 'danger'}>
                        {payment.status}
                      </Badge>
                      <span>{payment.origin}</span>
                      <span className="font-mono">${payment.amount}</span>
                      {payment.deliveredStatus !== null && payment.deliveredStatus >= 400 ? (
                        <Badge tone="danger">not delivered ({payment.deliveredStatus})</Badge>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {payment.txSignature === null ? null : (
                        <a
                          className="hover:text-highlight"
                          href={explorerUrl(payment.txSignature, payment.network)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          explorer ↗{' '}
                        </a>
                      )}
                      {formatDateTime(payment.createdAt, org.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Payees</CardTitle>
            <p className="mb-3 text-sm text-muted-foreground">
              Each paid site is bound to the address it was first paid. A different address waits here for Finance.
            </p>
            {payees.length === 0 ? (
              <EmptyState>No payees yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {payees.map((payee) => (
                  <li key={payee.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="space-x-2">
                      <Badge tone={payee.status === 'active' ? 'accent' : 'danger'}>{payee.status}</Badge>
                      <span>{payee.origin}</span>
                      <span className="break-all font-mono text-xs text-muted-foreground">{payee.payTo}</span>
                    </span>
                    {decide && payee.status === 'pending' ? <ApprovePayee orgId={orgId} payeeId={payee.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-8">
          <Card>
            <h2 className="mb-2 font-semibold">Solana</h2>
            {connection.connected ? (
              <p className="mb-3 text-sm">
                {connection.network} · treasury{' '}
                <span className="break-all font-mono text-xs">{connection.treasury}</span>
                {connection.anchorAudit ? ' · audit anchoring on' : ''}
                {connection.signerAvailable ? '' : ' · the signer is not configured on this deployment'}
              </p>
            ) : (
              <p className="mb-3 text-sm text-muted-foreground">
                Paste your treasury wallet’s public address. Aperture never asks for its key.
              </p>
            )}
            {can(org.role, 'connections.manage') ? (
              <SolanaConnectForm orgId={orgId} connected={connection.connected} />
            ) : null}
          </Card>
          {manageAgents && connection.connected ? (
            <Card>
              <h2 className="mb-4 font-semibold">New budget account</h2>
              <CreateAccountForm
                orgId={orgId}
                network={network}
                treasury={connection.treasury ?? ''}
                agents={agents.filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name }))}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
