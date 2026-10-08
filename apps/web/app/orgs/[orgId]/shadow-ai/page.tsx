import { can } from '@aperture/core';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatAmount } from '@/lib/format';
import { ClaimKey, ResolveCharge, ResolveReceipt } from './shadow-actions';
import { StatementUpload } from './statement-upload';

export default async function ShadowAiPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const org = await api.GET('/api/v1/orgs/{orgId}', path).then(unwrap);
  const role = org.role;
  const [external, credentials, agents, teams, receipts] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}/external-spend', path).then(unwrap),
    can(role, 'connections.read') ? api.GET('/api/v1/orgs/{orgId}/credentials', path).then(unwrap) : null,
    can(role, 'agents.read') ? api.GET('/api/v1/orgs/{orgId}/agents', path).then(unwrap) : null,
    api.GET('/api/v1/orgs/{orgId}/teams', path).then(unwrap),
    can(role, 'receipts.review')
      ? api.GET('/api/v1/orgs/{orgId}/receipts', { params: { path: { orgId }, query: { status: 'review' } } }).then(unwrap)
      : null,
  ]);
  const unassigned = credentials?.credentials.filter((c) => c.principal === null && c.status !== 'revoked') ?? [];
  const canImport = can(role, 'external_spend.import');
  const canAssignKeys = can(role, 'connections.manage');
  const open = external.rows.filter((r) => r.status === 'open' || r.status === 'assigned');
  const resolved = external.rows.filter((r) => r.status !== 'open' && r.status !== 'assigned');
  const assignees = (agents?.agents ?? []).map((a) => ({ id: a.id, name: a.name }));

  return (
    <>
      <PageHeader
        title="Shadow AI"
        description="AI spend Aperture doesn’t govern yet: provider keys nobody claimed, charges found on statements, and receipts to review."
      />
      <div className="space-y-8">
        {credentials === null ? null : (
          <Card>
            <CardTitle>Provider keys nobody claimed ({unassigned.length})</CardTitle>
            {unassigned.length === 0 ? (
              <EmptyState>Every imported provider key belongs to a person or agent.</EmptyState>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {unassigned.map((key) => (
                  <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{key.name}</span>{' '}
                      <span className="font-mono text-xs text-muted-foreground">
                        {key.provider}
                        {key.hint === null ? '' : ` · ${key.hint}`}
                      </span>
                    </span>
                    {canAssignKeys ? <ClaimKey orgId={orgId} credentialId={key.id} assignees={assignees} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {canImport ? (
          <Card>
            <CardTitle>Find AI charges on a statement</CardTitle>
            <StatementUpload orgId={orgId} />
          </Card>
        ) : null}

        <Card>
          <CardTitle action={<span className="font-mono text-sm">{formatAmount(external.openTotal, 'micros')} open</span>}>
            Charges found outside Aperture
          </CardTitle>
          {open.length === 0 ? (
            <EmptyState>Nothing open. Upload a statement to look for AI spend on company cards.</EmptyState>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {open.map((row) => (
                <li key={row.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{row.vendor}</span>{' '}
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.occurredOn} · {row.descriptor}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono">{formatAmount(row.amount, 'micros')}</span>
                      <span className="text-xs text-muted-foreground">
                        {row.originalAmount} {row.originalCurrency}
                      </span>
                    </span>
                  </div>
                  {row.assignedPrincipal === null ? null : <Badge>assigned to {row.assignedPrincipal.name}</Badge>}
                  {canImport ? <ResolveCharge orgId={orgId} rowId={row.id} assignees={assignees} teams={teams.teams} /> : null}
                </li>
              ))}
            </ul>
          )}
          {resolved.length === 0 ? null : (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">{resolved.length} resolved or provider invoices</summary>
              <ul className="mt-2 space-y-1">
                {resolved.map((row) => (
                  <li key={row.id} className="flex justify-between gap-2">
                    <span>
                      {row.vendor} · {row.occurredOn}
                    </span>
                    <span>
                      <Badge>{row.status.replace('_', ' ')}</Badge> <span className="font-mono">{formatAmount(row.amount, 'micros')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        {receipts === null ? null : (
          <Card>
            <CardTitle>Receipts to review ({receipts.receipts.length})</CardTitle>
            {receipts.receipts.length === 0 ? (
              <EmptyState>No receipts waiting. Receipts that don’t parse cleanly, or come from senders Aperture can’t verify, appear here.</EmptyState>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {receipts.receipts.map((receipt) => (
                  <li key={receipt.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>
                        {receipt.senderDomain ?? 'unknown sender'} · {receipt.reason}
                      </span>
                      <span className="font-mono text-xs">
                        {receipt.amount ?? '?'} {receipt.currency ?? ''} {receipt.occurredOn ?? ''}
                      </span>
                    </div>
                    <ResolveReceipt orgId={orgId} receiptId={receipt.id} defaults={receipt} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
