import { formatShare } from '@aperture/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AttestationVerifier } from '@/components/attestation-verifier';
import { Logo } from '@/components/logo';
import { Card, CardTitle } from '@/components/ui/card';
import { serverApi } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Shared attestation — Aperture', robots: { index: false } };

interface SharedDocument {
  org: { name: string };
  period: { from: string; to: string };
  issuer: { kind: string; instance: string };
  posture: { score: number; grade: string; results: { id: string; status: string; severity: string }[] };
  activity: { spendByRail: Record<string, string> };
  coverage: { status: string; basisPoints: number }[];
  disclaimer: string;
}

/** A shared attestation, opened from a share link (expiring, revocable, audited). */
export default async function SharedAttestationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const api = await serverApi();
  const { data } = await api.GET('/api/v1/public/attestations/{token}', { params: { path: { token } } });
  if (data === undefined) notFound();
  const document = data.document as unknown as SharedDocument;
  const failing = document.posture.results.filter((r) => r.status === 'fail' || r.status === 'unknown');

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <Logo href="/" />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{document.org.name}: governance attestation</h1>
        <p className="text-muted-foreground">
          {document.period.from.slice(0, 10)} → {document.period.to.slice(0, 10)} · issued by{' '}
          {document.issuer.kind === 'aperture_cloud' ? 'Aperture Cloud' : `the operator of ${document.issuer.instance}`}
        </p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardTitle>Posture</CardTitle>
          <p className="font-mono text-4xl">
            {document.posture.score}
            <span className="text-lg text-muted-foreground">/100</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Grade {document.posture.grade} · {failing.length} failing check(s)
          </p>
        </Card>
        <Card>
          <CardTitle>Coverage</CardTitle>
          <ul className="space-y-1 text-sm">
            {document.coverage.map((c) => (
              <li key={c.status} className="flex justify-between">
                <span className="capitalize">{c.status}</span>
                <span className="font-mono">{formatShare(c.basisPoints)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <AttestationVerifier initial={{ jws: data.jws }} />
      <p className="text-xs text-muted-foreground">{document.disclaimer}</p>
    </main>
  );
}
