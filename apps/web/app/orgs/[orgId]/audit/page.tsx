import { can } from '@aperture/core';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/card';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { VerifyChain } from './verify-chain';

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { orgId } = await params;
  const beforeParam = Number((await searchParams).before);
  const before = Number.isSafeInteger(beforeParam) && beforeParam > 0 ? beforeParam : undefined;
  const api = await serverApi();
  const [org, page] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', { params: { path: { orgId } } }).then(unwrap),
    api
      .GET('/api/v1/orgs/{orgId}/audit', {
        params: { path: { orgId }, query: { limit: 50, ...(before === undefined ? {} : { before }) } },
      })
      .then(unwrap),
  ]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change and decision, hash-chained so any edit or deletion is detectable."
        action={
          <div className="flex flex-wrap gap-3">
            <VerifyChain orgId={orgId} />
            {can(org.role, 'audit.export') ? (
              <a
                href={`/api/v1/orgs/${orgId}/audit/export`}
                download
                className="inline-flex h-10 items-center border border-border px-4 font-medium hover:bg-muted"
              >
                Export JSONL
              </a>
            ) : null}
          </div>
        }
      />
      {page.events.length === 0 ? (
        <EmptyState>Nothing recorded yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-normal">#</th>
                <th className="py-2 pr-4 font-normal">When</th>
                <th className="py-2 pr-4 font-normal">Action</th>
                <th className="py-2 pr-4 font-normal">Actor</th>
                <th className="py-2 pr-4 font-normal">Subject</th>
                <th className="py-2 font-normal">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {page.events.map((event) => (
                <tr key={event.id} className="align-top">
                  <td className="py-2 pr-4 font-mono text-muted-foreground">{event.seq}</td>
                  <td className="whitespace-nowrap py-2 pr-4">{formatDateTime(event.occurredAt, org.timezone)}</td>
                  <td className="py-2 pr-4 font-mono">{event.action}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{event.actor}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{event.subject}</td>
                  <td className="py-2 font-mono text-xs text-muted-foreground">{JSON.stringify(event.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-6 flex gap-4 text-sm">
        {before === undefined ? null : (
          <Link href={`/orgs/${orgId}/audit`} className="text-accent">
            Newest
          </Link>
        )}
        {page.nextBefore === null ? null : (
          <Link href={`/orgs/${orgId}/audit?before=${String(page.nextBefore)}`} className="text-accent">
            Older
          </Link>
        )}
      </div>
    </>
  );
}
