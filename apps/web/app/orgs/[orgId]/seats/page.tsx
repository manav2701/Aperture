import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatAmount, formatDateTime } from '@/lib/format';
import { ConnectSeats, EditSeat, ImportSeats, ReviewReceiptForm, SeatConnectionActions } from './seat-actions';

const PAYER_LABEL: Record<string, string> = {
  company: 'Company',
  personal_expensed: 'Personal, expensed',
  personal_unexpensed: 'Personal',
  unknown: 'Unknown',
};
const INSIGHT_LABEL: Record<string, string> = {
  idle_seat: 'Idle seat',
  duplicate: 'Paid twice',
  consolidate: 'Consolidate',
  seat_vs_api: 'Seat vs API',
  unapproved_tool: 'Not approved',
};

export default async function SeatsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const org = await api.GET('/api/v1/orgs/{orgId}', path).then(unwrap);
  const manage = can(org.role, 'seats.manage');
  const review = can(org.role, 'receipts.review');
  const [seats, insights, connections, providers, usage, tools, members, receipts] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}/seats', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/seats/insights', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/seat-connections', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/seat-providers', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/tool-usage', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/tools', path).then(unwrap),
    can(org.role, 'members.read') ? api.GET('/api/v1/orgs/{orgId}/members', path).then(unwrap) : null,
    review
      ? api
          .GET('/api/v1/orgs/{orgId}/receipts', { params: { path: { orgId }, query: { status: 'review' } } })
          .then(unwrap)
      : null,
  ]);
  const queue = receipts?.receipts ?? [];
  const people = (members?.members ?? []).map((m) => ({ userId: m.userId, name: m.name, email: m.email }));
  const live = seats.seats.filter((s) => s.status !== 'cancelled');
  const cancelled = seats.seats.filter((s) => s.status === 'cancelled');

  return (
    <>
      <PageHeader
        title="Seats"
        description="AI seats and subscriptions: who has which, who pays, and whether they’re used. Seats are visible here; Aperture can’t meter messages inside them."
      />
      <div className="mb-8 grid gap-6 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted-foreground">Seats</p>
          <p className="font-mono text-4xl">{seats.totals.seats}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Monthly cost (list price where unknown)</p>
          <p className="font-mono text-3xl">{formatAmount(seats.totals.monthlyCost, 'micros')}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Who pays</p>
          <ul className="mt-1 text-sm">
            {Object.entries(seats.totals.byPayer).map(([payer, n]) => (
              <li key={payer} className="flex justify-between">
                <span>{PAYER_LABEL[payer] ?? payer}</span>
                <span className="font-mono">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Estimated monthly savings</p>
          <p className="font-mono text-3xl text-highlight">{formatAmount(insights.monthlySaving, 'micros')}</p>
        </Card>
      </div>

      <div className="grid gap-8 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          <Card>
            <CardTitle>Insights</CardTitle>
            {insights.insights.length === 0 ? (
              <EmptyState>Nothing to act on. Insights appear as seats, receipts, and telemetry come in.</EmptyState>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {insights.insights.map((insight, index) => (
                  <li
                    key={`${insight.kind}-${insight.toolId}-${String(index)}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>
                      <Badge>{INSIGHT_LABEL[insight.kind] ?? insight.kind}</Badge> {insight.detail}
                    </span>
                    {insight.monthlySaving === '0.00' ? null : (
                      <span className="font-mono text-highlight">
                        save {formatAmount(insight.monthlySaving, 'micros')}/mo
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {queue.length === 0 ? null : (
            <Card>
              <CardTitle>Receipts to review ({queue.length})</CardTitle>
              <p className="mb-3 text-sm text-muted-foreground">
                These didn’t come from a known vendor with a verified signature, or didn’t parse. Check them, then
                import or dismiss. Only the fields below are kept; the email itself was discarded.
              </p>
              <ul className="divide-y divide-border">
                {queue.map((receipt) => (
                  <li key={receipt.id} className="space-y-2 py-3">
                    <p className="text-sm">
                      {receipt.senderDomain ?? 'unknown sender'}
                      <span className="text-muted-foreground">
                        {' '}
                        · {receipt.submittedBy?.name ?? 'inbound address'} ·{' '}
                        {formatDateTime(receipt.createdAt, org.timezone)}
                      </span>
                      {receipt.reason === null ? null : (
                        <span className="block text-xs text-muted-foreground">{receipt.reason}</span>
                      )}
                    </p>
                    <ReviewReceiptForm
                      orgId={orgId}
                      receipt={receipt}
                      tools={tools.tools.map((t) => ({ id: t.id, product: t.product }))}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardTitle>All seats ({live.length})</CardTitle>
            {live.length === 0 ? (
              <EmptyState>
                No seats yet. Connect a product, import an admin-console export, or ask members to declare their tools.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2">Tool</th>
                      <th>Holder</th>
                      <th>Payer</th>
                      <th className="text-right">Cost/mo</th>
                      <th>Active days (30)</th>
                      <th>Source</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {live.map((seat) => (
                      <tr key={seat.id} className="align-top">
                        <td className="py-2">
                          {seat.tool}
                          {seat.planName === null ? null : (
                            <span className="block text-xs text-muted-foreground">{seat.planName}</span>
                          )}
                        </td>
                        <td>
                          {seat.holder === null ? (
                            <span className="text-muted-foreground">{seat.externalUserRef ?? 'unlinked'}</span>
                          ) : (
                            <>
                              {seat.holder.name}
                              {seat.holder.isMember ? null : <Badge tone="danger">left</Badge>}
                            </>
                          )}
                        </td>
                        <td>{PAYER_LABEL[seat.payer]}</td>
                        <td className="text-right font-mono">
                          {seat.monthlyCost === null
                            ? seat.listPrice === null
                              ? '—'
                              : `${formatAmount(seat.listPrice, 'micros')}*`
                            : formatAmount(seat.monthlyCost, 'micros')}
                        </td>
                        <td>
                          {seat.activeDays30}
                          {seat.lastActiveAt === null ? null : (
                            <span className="block text-xs text-muted-foreground">
                              last {formatDateTime(seat.lastActiveAt, org.timezone)}
                            </span>
                          )}
                        </td>
                        <td>
                          <Badge>{seat.source}</Badge>
                        </td>
                        <td>{manage ? <EditSeat orgId={orgId} seat={seat} people={people} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  * list price; set the real cost to improve estimates.
                </p>
              </div>
            )}
            {cancelled.length === 0 ? null : (
              <p className="mt-3 text-xs text-muted-foreground">{cancelled.length} cancelled seat(s) hidden.</p>
            )}
          </Card>

          <Card>
            <CardTitle>Terminal tools, last 30 days</CardTitle>
            {usage.people.length === 0 ? (
              <EmptyState>No telemetry yet. Developers connect Claude Code from My AI tools.</EmptyState>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {usage.people.map((p) => (
                  <li key={`${p.userId}-${p.tool}`} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {p.name} <span className="text-xs text-muted-foreground">{p.tool.replace('_', ' ')}</span>
                    </span>
                    <span className="font-mono text-xs">
                      {p.sessions} sessions · {p.linesAdded} lines · {formatAmount(p.cost, 'micros')} at API prices
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-8">
          <Card>
            <CardTitle>Connected products</CardTitle>
            {connections.connections.length === 0 ? (
              <EmptyState>None yet.</EmptyState>
            ) : (
              <ul className="space-y-3 text-sm">
                {connections.connections.map((c) => (
                  <li key={c.id} className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge tone={c.status === 'active' ? 'accent' : 'danger'}>{c.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.seats} seats · synced{' '}
                      {c.lastSyncedAt === null ? 'never' : formatDateTime(c.lastSyncedAt, org.timezone)}
                    </p>
                    {c.lastError === null ? null : <p className="text-xs text-danger">{c.lastError}</p>}
                    {manage ? <SeatConnectionActions orgId={orgId} connectionId={c.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
            {manage ? <ConnectSeats orgId={orgId} providers={providers.providers} /> : null}
          </Card>
          {manage ? (
            <Card>
              <CardTitle>Import from an admin console</CardTitle>
              <ImportSeats
                orgId={orgId}
                tools={tools.tools.map((t) => ({ id: t.id, product: t.product, plans: t.plans }))}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
