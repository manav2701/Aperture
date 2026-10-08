'use client';

import { formatShare } from '@aperture/core';
import { useState } from 'react';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { FormError, FormNotice, Input } from '@/components/ui/form';
import {
  checkAuditExport,
  verifyAttestationJws,
  type AuditRangeCheck,
  type Jwk,
  type SignatureCheck,
} from '@/lib/verify';

interface Document {
  id?: string;
  org?: { name?: string };
  period?: { from?: string; to?: string };
  issuer?: { kind?: string; instance?: string };
  posture?: { score?: number; grade?: string };
  coverage?: { status: string; basisPoints: number }[];
  audit?: {
    firstSeq: number | null;
    lastSeq: number | null;
    prevHash: string | null;
    lastHash: string | null;
    merkleRoot: string | null;
    chainIntact?: boolean;
  };
  disclaimer?: string;
}

async function loadJwks(): Promise<{ keys: Jwk[] }> {
  const response = await fetch('/api/v1/public/jwks.json');
  if (!response.ok) throw new Error('could not load the published keys');
  return (await response.json()) as { keys: Jwk[] };
}

/** Verifies an attestation in the browser; with `initial` it starts from a shared one. */
export function AttestationVerifier({ initial }: { initial?: { jws: string } }) {
  const [signature, setSignature] = useState<SignatureCheck | null>(null);
  const [audit, setAudit] = useState<AuditRangeCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const document = (signature?.payload ?? null) as Document | null;

  const verify = async (jws: string) => {
    setError(null);
    setAudit(null);
    try {
      setSignature(await verifyAttestationJws(jws, await loadJwks()));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onAttestation = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { jws?: string };
      if (typeof parsed.jws !== 'string')
        throw new Error('this file has no "jws" field; download the JSON from Aperture');
      await verify(parsed.jws);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onAudit = async (file: File) => {
    if (document?.audit === undefined) return;
    try {
      setAudit(await checkAuditExport(await file.text(), document.audit));
    } catch {
      setError('the audit export could not be read (expected JSON lines)');
    }
  };

  return (
    <div className="space-y-6">
      {initial === undefined ? (
        <Card>
          <CardTitle>1. The attestation</CardTitle>
          <Input
            type="file"
            accept=".json,application/json"
            className="py-2"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) void onAttestation(file);
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            The file stays in your browser; only the public keys are fetched.
          </p>
        </Card>
      ) : (
        <button
          type="button"
          className="border border-border px-4 py-2 text-sm hover:border-accent"
          onClick={() => void verify(initial.jws)}
        >
          Verify the signature
        </button>
      )}
      <FormError message={error} />
      {signature === null ? null : (
        <Card>
          <CardTitle
            action={
              <Badge tone={signature.ok ? 'accent' : 'danger'}>{signature.ok ? 'valid signature' : 'invalid'}</Badge>
            }
          >
            Result
          </CardTitle>
          {signature.ok ? null : <p className="mb-3 text-sm text-danger">{signature.reason}</p>}
          {document === null ? null : (
            <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Organization</dt>
              <dd>{document.org?.name}</dd>
              <dt className="text-muted-foreground">Period</dt>
              <dd>
                {document.period?.from?.slice(0, 10)} → {document.period?.to?.slice(0, 10)}
              </dd>
              <dt className="text-muted-foreground">Issued by</dt>
              <dd>
                {document.issuer?.kind === 'aperture_cloud'
                  ? 'Aperture Cloud'
                  : `operator of ${document.issuer?.instance ?? '?'} (self-hosted)`}
              </dd>
              <dt className="text-muted-foreground">Signing key</dt>
              <dd className="font-mono text-xs">{signature.kid}</dd>
              <dt className="text-muted-foreground">Posture</dt>
              <dd>
                {document.posture?.score} / 100 (grade {document.posture?.grade})
              </dd>
              <dt className="text-muted-foreground">Coverage</dt>
              <dd>{document.coverage?.map((c) => `${c.status} ${formatShare(c.basisPoints)}`).join(' · ')}</dd>
              <dt className="text-muted-foreground">Audit chain</dt>
              <dd>
                {document.audit?.chainIntact === true ? 'intact' : 'broken'} · seq {document.audit?.firstSeq ?? '–'} to{' '}
                {document.audit?.lastSeq ?? '–'}
              </dd>
            </dl>
          )}
          {document?.disclaimer === undefined ? null : <FormNotice>{document.disclaimer}</FormNotice>}
        </Card>
      )}
      {signature?.ok === true && document?.audit !== undefined ? (
        <Card>
          <CardTitle>2. Optional: the audit export for the period</CardTitle>
          <Input
            type="file"
            accept=".jsonl,.ndjson,application/x-ndjson"
            className="py-2"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) void onAudit(file);
            }}
          />
          {audit === null ? null : (
            <p className={audit.ok ? 'mt-3 text-sm' : 'mt-3 text-sm text-danger'}>
              {audit.ok
                ? `The ${String(audit.events)} events link up and their Merkle root matches the attestation.`
                : `Mismatch: ${audit.reason ?? 'unknown'}.`}
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
