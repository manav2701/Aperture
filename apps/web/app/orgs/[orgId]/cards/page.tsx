import { can } from '@aperture/core';
import Link from 'next/link';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { CardStatusActions, IssueCardForm, StripeConnectForm } from './card-forms';

export default async function CardsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, stripe, { cards }, { agents }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/cards/stripe', path).then((result) => result.data),
    api.GET('/api/v1/orgs/{orgId}/cards', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/agents', path).then(unwrap),
  ]);
  const manageConnection = can(org.role, 'connections.manage');
  const manageCards = can(org.role, 'agents.manage');

  return (
    <>
      <PageHeader
        title="Cards"
        description="Virtual cards from your own Stripe Issuing program. Stripe asks Aperture about every purchase and Aperture answers from your budgets and policies in real time. Aperture never sees card numbers."
      />
      <div className="grid gap-8 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          <Card>
            <CardTitle>Cards ({cards.length})</CardTitle>
            {cards.length === 0 ? (
              <EmptyState>No cards yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {cards.map((card) => (
                  <li key={card.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span className="space-x-2">
                      <Link href={`/orgs/${orgId}/cards/${card.id}`} className="font-mono hover:text-highlight">
                        •• {card.last4 ?? '????'}
                      </Link>
                      <span>{card.principal.name}</span>
                      <Badge tone={card.status === 'active' ? 'accent' : 'danger'}>{card.status}</Badge>
                      {card.kind === 'task' ? <Badge>single-use</Badge> : null}
                      {card.purpose === null ? null : <span className="text-muted-foreground">{card.purpose}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {card.expiresAt === null ? '' : `expires ${formatDateTime(card.expiresAt, org.timezone)} · `}
                        {formatDateTime(card.createdAt, org.timezone)}
                      </span>
                      {manageCards ? <CardStatusActions orgId={orgId} cardId={card.id} status={card.status} /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-8">
          <Card>
            <h2 className="mb-2 font-semibold">Stripe Issuing</h2>
            {stripe?.connected === true ? (
              <div className="space-y-3 text-sm">
                <p>
                  Connected{stripe.livemode ? '' : ' (test mode)'}. In Stripe → Issuing, set these endpoints and set the
                  authorization <strong>timeout behaviour to decline</strong>:
                </p>
                <p className="text-xs text-muted-foreground">Real-time authorization</p>
                <code className="block break-all bg-muted p-2 font-mono text-xs">{stripe.authorizationUrl}</code>
                <p className="text-xs text-muted-foreground">
                  Events (issuing_authorization.created/updated, issuing_transaction.created, issuing_card.updated)
                </p>
                <code className="block break-all bg-muted p-2 font-mono text-xs">{stripe.eventsUrl}</code>
                <p className="text-xs text-muted-foreground">
                  Last 30 days: {stripe.last30Days.approved} approved, {stripe.last30Days.declined} declined
                  {stripe.last30Days.unseen > 0 ? (
                    <span className="text-danger">
                      , {stripe.last30Days.unseen} decided by Stripe without Aperture — check the timeout setting
                    </span>
                  ) : null}
                  .
                </p>
              </div>
            ) : (
              <p className="mb-4 text-sm text-muted-foreground">
                Bring your own card program: create a restricted key in Stripe (Issuing cards, cardholders,
                authorizations and transactions: write; Disputes: write) and two webhook endpoints.
              </p>
            )}
            {manageConnection ? <StripeConnectForm orgId={orgId} reconnect={stripe?.connected === true} /> : null}
          </Card>
          {manageCards && stripe?.connected === true ? (
            <Card>
              <h2 className="mb-4 font-semibold">Issue a card</h2>
              <IssueCardForm
                orgId={orgId}
                agents={agents.filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name }))}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
