import Link from 'next/link';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';

export default async function CardPage({ params }: { params: Promise<{ orgId: string; cardId: string }> }) {
  const { orgId, cardId } = await params;
  const api = await serverApi();
  const [org, { cards }, { authorizations }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', { params: { path: { orgId } } }).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/cards', { params: { path: { orgId } } }).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/cards/{cardId}/authorizations', { params: { path: { orgId, cardId } } }).then(unwrap),
  ]);
  const card = cards.find((c) => c.id === cardId);
  const merchantName = (merchant: Record<string, unknown>) => (typeof merchant.name === 'string' ? merchant.name : '—');
  const reasonsOf = (reasons: unknown[]) =>
    reasons
      .map((r) =>
        typeof r === 'object' && r !== null && 'message' in r && typeof r.message === 'string' ? r.message : '',
      )
      .filter((m) => m !== '')
      .join('; ');

  return (
    <>
      <PageHeader
        title={card === undefined ? 'Card' : `Card •• ${card.last4 ?? '????'} · ${card.principal.name}`}
        description="Every purchase attempt with Aperture’s real-time decision. Holds settle when Stripe closes the authorization."
        action={
          <Link href={`/orgs/${orgId}/cards`} className="text-sm hover:text-highlight">
            ← All cards
          </Link>
        }
      />
      <Card>
        <CardTitle>Authorizations</CardTitle>
        {authorizations.length === 0 ? (
          <EmptyState>No purchases yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {authorizations.map((auth) => (
              <li key={auth.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span className="space-x-2">
                  <Badge tone={auth.decision === 'approved' ? 'accent' : 'danger'}>{auth.decision}</Badge>
                  <span>{merchantName(auth.merchant)}</span>
                  <span className="font-mono">${auth.settled ?? auth.requested}</span>
                  <span className="text-muted-foreground">
                    {auth.status}
                    {auth.currency === 'usd' ? '' : ` · ${auth.currency.toUpperCase()}`}
                  </span>
                  {auth.decision === 'approved' ? null : (
                    <span className="text-xs text-muted-foreground">{reasonsOf(auth.reasons)}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(auth.createdAt, org.timezone)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
