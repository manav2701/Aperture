import { can } from '@aperture/core';
import Link from 'next/link';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatAmount, formatDateTime } from '@/lib/format';
import { AgentGovernanceForm } from './governance-form';

const DATA_CLASS_LABEL: Record<string, string> = {
  none: 'No sensitive data',
  internal: 'Internal',
  customer_personal: 'Customer personal data',
  financial: 'Financial',
  health: 'Health',
};

export default async function AgentCardPage({ params }: { params: Promise<{ orgId: string; agentId: string }> }) {
  const { orgId, agentId } = await params;
  const api = await serverApi();
  const [org, card] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', { params: { path: { orgId } } }).then(unwrap),
    api
      .GET('/api/v1/orgs/{orgId}/agents/{principalId}/card', { params: { path: { orgId, principalId: agentId } } })
      .then(unwrap),
  ]);
  const base = `/orgs/${orgId}`;
  const manage = can(org.role, 'agents.manage');
  const canSetRisk = org.role === 'owner' || org.role === 'admin';
  const at = (iso: string | null) => (iso === null ? '—' : formatDateTime(iso, org.timezone));

  return (
    <>
      <PageHeader
        title={card.name}
        description={card.description ?? 'Agent card: everything about this agent on one page.'}
        action={
          <a
            href={`/api/v1/orgs/${orgId}/agents/${agentId}/card.jws`}
            className="inline-flex h-9 items-center border border-border px-4 text-sm hover:border-accent"
            download
          >
            Download signed card
          </a>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={card.status === 'active' ? 'accent' : 'danger'}>{card.status}</Badge>
        <Badge tone={card.governance === 'enforced' ? 'accent' : 'muted'}>{card.governance}</Badge>
        {card.declared.riskTier === null ? (
          <Badge>risk not set</Badge>
        ) : (
          <Badge tone={card.declared.riskTier === 'high' ? 'danger' : 'muted'}>{card.declared.riskTier} risk</Badge>
        )}
        {card.team === null ? null : <Badge>{card.team.name}</Badge>}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Identity and purpose</CardTitle>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Owner</dt>
            <dd>
              {card.owner === null ? 'none' : card.owner.name}
              {card.owner !== null && !card.owner.isMember ? <Badge tone="danger">left the org</Badge> : null}
            </dd>
            <dt className="text-muted-foreground">Delegated by</dt>
            <dd>
              {card.parent === null ? (
                '—'
              ) : (
                <Link href={`${base}/agents/${card.parent.id}`} className="underline">
                  {card.parent.name}
                </Link>
              )}
            </dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{at(card.createdAt)}</dd>
            <dt className="text-muted-foreground">Purpose</dt>
            <dd>{card.declared.purpose ?? 'not declared'}</dd>
            <dt className="text-muted-foreground">Data it handles</dt>
            <dd>
              {card.declared.dataClasses.length === 0
                ? 'not declared'
                : card.declared.dataClasses.map((d) => DATA_CLASS_LABEL[d] ?? d).join(', ')}
            </dd>
          </dl>
          {manage ? (
            <AgentGovernanceForm orgId={orgId} agentId={agentId} declared={card.declared} canSetRisk={canSetRisk} />
          ) : null}
        </Card>

        <Card>
          <CardTitle>Budgets on its path</CardTitle>
          {card.budgets.length === 0 ? (
            <EmptyState>No money budget applies. Spend is unbounded except by policy.</EmptyState>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {card.budgets.map((b) => (
                <li key={b.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {b.name}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({b.scope}, {b.mode}, per {b.period})
                    </span>
                  </span>
                  <span className="font-mono text-xs">
                    {formatAmount(b.spent, 'micros')} + {formatAmount(b.held, 'micros')} held of{' '}
                    {formatAmount(b.limit, 'micros')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Rules that apply</CardTitle>
          {card.rules.length === 0 ? (
            <EmptyState>No policy rules.</EmptyState>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {card.rules.map((rule) => (
                <li key={`${rule.level}:${rule.id}`}>
                  <Badge>
                    {rule.level} · {rule.type.replaceAll('_', ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {card.mandates.length === 0 ? null : (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">Active mandates</h3>
              <ul className="space-y-1 text-sm">
                {card.mandates.map((m) => (
                  <li key={m.id}>
                    {m.purpose} <span className="text-xs text-muted-foreground">until {at(m.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {card.subAgents.length === 0 ? null : (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold">Sub-agents</h3>
              <ul className="flex flex-wrap gap-1">
                {card.subAgents.map((s) => (
                  <li key={s.id}>
                    <Link href={`${base}/agents/${s.id}`}>
                      <Badge>{s.name}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card>
          <CardTitle>Means to spend</CardTitle>
          <ul className="space-y-1 text-sm">
            {card.means.keys.map((k) => (
              <li key={k.id}>
                Gateway key <span className="font-mono">{k.prefix}…</span> {k.name}{' '}
                <span className="text-xs text-muted-foreground">
                  last used {at(k.lastUsedAt)} · expires {at(k.expiresAt)}
                </span>
              </li>
            ))}
            {card.means.providerKeys.map((k) => (
              <li key={k.id}>
                {k.provider} key {k.name} {k.hint === null ? '' : <span className="font-mono text-xs">{k.hint}</span>}
              </li>
            ))}
            {card.means.cards.map((c) => (
              <li key={c.id}>
                {c.kind} card {c.last4 === null ? '' : `••${c.last4}`} <Badge>{c.status}</Badge>
              </li>
            ))}
            {card.means.x402Accounts.map((x) => (
              <li key={x.id}>
                Crypto account on {x.network} <Badge>{x.status}</Badge>
              </li>
            ))}
          </ul>
          {card.means.keys.length +
            card.means.providerKeys.length +
            card.means.cards.length +
            card.means.x402Accounts.length ===
          0 ? (
            <EmptyState>It holds nothing it can spend with.</EmptyState>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Revoke keys on{' '}
              <Link href={`${base}/agents`} className="underline">
                Agents &amp; keys
              </Link>
              , cards on{' '}
              <Link href={`${base}/cards`} className="underline">
                Cards
              </Link>
              , allowances on{' '}
              <Link href={`${base}/crypto`} className="underline">
                Crypto
              </Link>
              .
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Last 30 days</CardTitle>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Spend</dt>
            <dd className="font-mono text-xs">
              {Object.entries(card.activity.spendByRail)
                .map(([rail, amount]) => `${rail} ${formatAmount(amount, 'micros')}`)
                .join(' · ') || '—'}
            </dd>
            <dt className="text-muted-foreground">Top models</dt>
            <dd className="text-xs">
              {card.activity.spendByModel.map((m) => `${m.model} ${formatAmount(m.amount, 'micros')}`).join(' · ') ||
                '—'}
            </dd>
            <dt className="text-muted-foreground">Requests</dt>
            <dd className="text-xs">
              {Object.entries(card.activity.outcomes)
                .map(([o, n]) => `${o.replaceAll('_', ' ')} ${String(n)}`)
                .join(' · ') || '—'}
            </dd>
            <dt className="text-muted-foreground">Approvals</dt>
            <dd className="text-xs">
              {card.activity.approvals.asked} asked · {card.activity.approvals.granted} granted ·{' '}
              {card.activity.approvals.denied} denied
            </dd>
            <dt className="text-muted-foreground">Kill switch</dt>
            <dd className="text-xs">{card.activity.killSwitchEvents} use(s)</dd>
            <dt className="text-muted-foreground">Last activity</dt>
            <dd className="text-xs">{at(card.activity.lastActivityAt)}</dd>
          </dl>
        </Card>

        <Card>
          <CardTitle>Posture</CardTitle>
          {card.posture.length === 0 ? (
            <EmptyState>No posture check names this agent.</EmptyState>
          ) : (
            <ul className="space-y-1 text-sm">
              {card.posture.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>{p.title}</span>
                  <Badge tone={p.status === 'fail' ? 'danger' : 'muted'}>{p.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mb-2 mt-4 text-sm font-semibold">Recent audit events</h3>
          <ul className="space-y-1 font-mono text-xs">
            {card.recentAudit.map((e) => (
              <li key={e.seq}>
                #{e.seq} {e.action} <span className="text-muted-foreground">{at(e.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
