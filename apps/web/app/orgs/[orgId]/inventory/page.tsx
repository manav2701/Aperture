import { formatShare } from '@aperture/core';
import Link from 'next/link';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { cn } from '@/lib/cn';
import { formatAmount, formatDateTime } from '@/lib/format';

const STATUS_LABEL = {
  enforced: 'Enforced',
  visible: 'Visible',
  unassigned: 'Unassigned',
  external: 'External',
} as const;
type Status = keyof typeof STATUS_LABEL;
const STATUS_COLOR: Record<Status, string> = {
  enforced: 'bg-accent',
  visible: 'bg-highlight/60',
  unassigned: 'bg-danger/70',
  external: 'bg-muted-foreground/50',
};
const STATUS_FILL: Record<Status, string> = {
  enforced: 'fill-accent',
  visible: 'fill-highlight/60',
  unassigned: 'fill-danger/70',
  external: 'fill-muted-foreground/50',
};
const KIND_LABEL: Record<string, string> = {
  agent: 'Agent',
  person: 'Person',
  gateway_key: 'Gateway key',
  provider_key: 'Provider key',
  connection: 'Connection',
  model: 'Model',
  card: 'Card',
  x402_account: 'Crypto account',
  mandate: 'Mandate',
  seat: 'Seat',
  external_tool: 'External tool',
};

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ status?: string; kind?: string }>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, inventory] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/inventory', path).then(unwrap),
  ]);
  const status = query.status !== undefined && query.status in STATUS_LABEL ? (query.status as Status) : undefined;
  const kind = query.kind !== undefined && query.kind in KIND_LABEL ? query.kind : undefined;
  const rows = inventory.rows.filter(
    (r) => (status === undefined || r.status === status) && (kind === undefined || r.kind === kind),
  );
  const base = `/orgs/${orgId}/inventory`;
  const href = (next: { status?: string | undefined; kind?: string | undefined }) => {
    const params = new URLSearchParams();
    const s = 'status' in next ? next.status : status;
    const k = 'kind' in next ? next.kind : kind;
    if (s !== undefined) params.set('status', s);
    if (k !== undefined) params.set('kind', k);
    return params.size === 0 ? base : `${base}?${params.toString()}`;
  };
  const chip = (active: boolean) =>
    cn(
      'border px-2 py-1 text-xs',
      active ? 'border-accent text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
    );
  const kinds = [...new Set(inventory.rows.map((r) => r.kind))];
  const total = inventory.coverage.reduce((sum, share) => sum + share.basisPoints, 0);

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Everything in this organization that can spend on AI, and how much of that spend Aperture governs."
        action={
          <a
            href={`/api/v1/orgs/${orgId}/inventory.csv`}
            className="inline-flex h-9 items-center border border-border px-4 text-sm hover:border-accent"
            download
          >
            Export CSV
          </a>
        }
      />
      <Card className="mb-8">
        <CardTitle>Governance coverage, last 30 days</CardTitle>
        {total === 0 ? (
          <EmptyState>No AI spend recorded yet. Connect a provider, upload a statement, or add seats.</EmptyState>
        ) : (
          <>
            {/* SVG attributes, not inline styles: the CSP allows no style attributes. */}
            <svg
              viewBox="0 0 10000 10"
              preserveAspectRatio="none"
              className="h-4 w-full"
              role="img"
              aria-label="Coverage shares"
            >
              {inventory.coverage.map((share, index) => {
                const x = inventory.coverage.slice(0, index).reduce((sum, s) => sum + s.basisPoints, 0);
                return (
                  <rect
                    key={share.status}
                    x={x}
                    y={0}
                    width={share.basisPoints}
                    height={10}
                    className={STATUS_FILL[share.status]}
                  />
                );
              })}
            </svg>
            <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
              {inventory.coverage.map((share) => (
                <li key={share.status}>
                  <span className={cn('mr-2 inline-block h-2 w-2', STATUS_COLOR[share.status])} />
                  <span className="font-medium">{STATUS_LABEL[share.status]}</span>{' '}
                  <span className="font-mono">{formatShare(share.basisPoints)}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {formatAmount(share.amount, 'micros')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={href({ status: undefined })} className={chip(status === undefined)}>
          All statuses
        </Link>
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <Link key={s} href={href({ status: s })} className={chip(status === s)}>
            {STATUS_LABEL[s]}
          </Link>
        ))}
        <span className="mx-2 border-l border-border" />
        <Link href={href({ kind: undefined })} className={chip(kind === undefined)}>
          All kinds
        </Link>
        {kinds.map((k) => (
          <Link key={k} href={href({ kind: k })} className={chip(kind === k)}>
            {KIND_LABEL[k] ?? k}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState>Nothing matches these filters.</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">What</th>
                <th className="p-2">Kind</th>
                <th className="p-2">Owner</th>
                <th className="p-2">Governance</th>
                <th className="p-2 text-right">30 days</th>
                <th className="p-2">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.id}`}>
                  <td className="p-2">
                    {row.kind === 'agent' ? (
                      <Link href={`/orgs/${orgId}/agents/${row.id}`} className="hover:text-highlight">
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                    {row.detail === null ? null : (
                      <span className="block text-xs text-muted-foreground">{row.detail}</span>
                    )}
                  </td>
                  <td className="p-2">{KIND_LABEL[row.kind] ?? row.kind}</td>
                  <td className="p-2">{row.owner ?? '—'}</td>
                  <td className="p-2">
                    <Badge
                      tone={row.status === 'enforced' ? 'accent' : row.status === 'unassigned' ? 'danger' : 'muted'}
                    >
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </td>
                  <td className="p-2 text-right font-mono">{formatAmount(row.spend30d, 'micros')}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {row.lastActivityAt === null ? '—' : formatDateTime(row.lastActivityAt, org.timezone)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
