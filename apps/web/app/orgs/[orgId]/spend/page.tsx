import Link from 'next/link';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { cn } from '@/lib/cn';
import { formatAmount, formatDateTime } from '@/lib/format';

const RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;
const GROUPS = { principal: 'Who', provider: 'Provider', day: 'Day', rail: 'Rail' } as const;
type Range = keyof typeof RANGES;
type Group = keyof typeof GROUPS;

const outcomeTone = (outcome: string) =>
  outcome === 'allowed' ? 'accent' : outcome.startsWith('denied') ? 'danger' : 'muted';

export default async function SpendPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ range?: string; group?: string }>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const range: Range = query.range !== undefined && query.range in RANGES ? (query.range as Range) : '30d';
  const group: Group = query.group !== undefined && query.group in GROUPS ? (query.group as Group) : 'principal';
  const from = new Date(Date.now() - RANGES[range] * 86_400_000).toISOString();

  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, spend, { entries }, { requests }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api
      .GET('/api/v1/orgs/{orgId}/spend', { params: { path: { orgId }, query: { from, groupBy: group } } })
      .then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/spend/entries', { params: { path: { orgId }, query: { limit: 25 } } }).then(unwrap),
    api
      .GET('/api/v1/orgs/{orgId}/gateway/requests', { params: { path: { orgId }, query: { limit: 25 } } })
      .then(unwrap),
  ]);
  const href = (next: { range?: Range; group?: Group }) =>
    `/orgs/${orgId}/spend?range=${next.range ?? range}&group=${next.group ?? group}`;
  const tab = (active: boolean) =>
    cn('px-3 py-1.5 text-sm', active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground');

  return (
    <>
      <PageHeader
        title="Spend"
        description="Everything spent through the gateway and on connected provider keys, from one ledger."
        action={
          <div className="flex gap-1">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Link key={r} href={href({ range: r })} className={tab(r === range)}>
                {r}
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid gap-8 xl:grid-cols-2">
        <Card>
          <CardTitle
            action={
              <div className="flex gap-1">
                {(Object.keys(GROUPS) as Group[]).map((g) => (
                  <Link key={g} href={href({ group: g })} className={tab(g === group)}>
                    {GROUPS[g]}
                  </Link>
                ))}
              </div>
            }
          >
            <span className="font-mono text-2xl">{formatAmount(spend.total, 'micros')}</span>
          </CardTitle>
          {spend.groups.length === 0 ? (
            <EmptyState>No spend in this period.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {spend.groups.map((row) => (
                <li key={row.key} className="flex justify-between gap-4 py-2 text-sm">
                  <span className="truncate">{row.label}</span>
                  <span className="font-mono">{formatAmount(row.amount, 'micros')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Latest entries</CardTitle>
          {entries.length === 0 ? (
            <EmptyState>Nothing recorded yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{entry.principal.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {entry.kind} · {entry.provider ?? entry.rail}
                      {entry.model === null ? '' : ` · ${entry.model}`}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-mono">{formatAmount(entry.amount, 'micros')}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(entry.occurredAt, org.timezone)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardTitle>Gateway requests</CardTitle>
          {requests.length === 0 ? (
            <EmptyState>No requests through the gateway yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-normal">When</th>
                    <th className="py-2 pr-4 font-normal">Who</th>
                    <th className="py-2 pr-4 font-normal">Model</th>
                    <th className="py-2 pr-4 font-normal">Decision</th>
                    <th className="py-2 pr-4 font-normal">Tokens in/out</th>
                    <th className="py-2 pr-4 font-normal">Cost</th>
                    <th className="py-2 font-normal">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="whitespace-nowrap py-2 pr-4">{formatDateTime(request.createdAt, org.timezone)}</td>
                      <td className="py-2 pr-4">{request.principal.name}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{request.model ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <Badge tone={outcomeTone(request.outcome)}>{request.outcome.replace('_', ' ')}</Badge>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {request.inputTokens ?? '—'} / {request.outputTokens ?? '—'}
                      </td>
                      <td className="py-2 pr-4 font-mono">
                        {request.cost === null ? '—' : formatAmount(request.cost, 'micros')}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {request.latencyMs === null ? '—' : `${String(request.latencyMs)} ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
