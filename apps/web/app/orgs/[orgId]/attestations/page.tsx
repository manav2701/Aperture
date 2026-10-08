import { ATTESTATION_DISCLAIMER, can } from '@aperture/core';
import Link from 'next/link';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui/card';
import { FormNotice } from '@/components/ui/form';
import { serverApi, unwrap } from '@/lib/api/server';
import { formatDateTime } from '@/lib/format';
import { NewAttestation, ShareLinks } from './attestation-actions';

export default async function AttestationsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const api = await serverApi();
  const path = { params: { path: { orgId } } };
  const [org, { attestations }] = await Promise.all([
    api.GET('/api/v1/orgs/{orgId}', path).then(unwrap),
    api.GET('/api/v1/orgs/{orgId}/attestations', path).then(unwrap),
  ]);
  const canCreate = can(org.role, 'attestation.create');
  const day = (iso: string) => iso.slice(0, 10);

  return (
    <>
      <PageHeader
        title="Attestations"
        description="Signed records of what Aperture observed and enforced over a period. Anyone can verify one without trusting Aperture."
      />
      <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {attestations.length === 0 ? (
            <EmptyState>No attestations yet.</EmptyState>
          ) : (
            attestations.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {day(a.periodFrom)} → {day(a.periodTo)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Signed {formatDateTime(a.createdAt, org.timezone)} · key <span className="font-mono">{a.kid}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.score === null ? null : (
                      <Badge tone="accent">
                        posture {a.score} · {a.grade}
                      </Badge>
                    )}
                    <a className="text-sm underline" href={`/api/v1/orgs/${orgId}/attestations/${a.id}`} download>
                      JSON
                    </a>
                    <a className="text-sm underline" href={`/api/v1/orgs/${orgId}/attestations/${a.id}/pdf`} download>
                      PDF
                    </a>
                  </div>
                </div>
                {canCreate ? <ShareLinks orgId={orgId} attestationId={a.id} /> : null}
              </Card>
            ))
          )}
        </div>
        <div className="space-y-4">
          {canCreate ? (
            <Card>
              <CardTitle>New attestation</CardTitle>
              <NewAttestation orgId={orgId} />
            </Card>
          ) : null}
          <Card>
            <CardTitle>Verify one</CardTitle>
            <p className="text-sm text-muted-foreground">
              Open <Link href="/verify" className="underline">the verify page</Link> and drop in the JSON file, or run{' '}
              <code className="font-mono text-xs">pnpm attestation-verify att.json</code>.
            </p>
          </Card>
          <FormNotice>{ATTESTATION_DISCLAIMER}</FormNotice>
        </div>
      </div>
    </>
  );
}
