import type { Metadata } from 'next';
import { AttestationVerifier } from '@/components/attestation-verifier';
import { Logo } from '@/components/logo';

export const metadata: Metadata = { title: 'Verify an attestation — Aperture' };

/** Public: anyone can verify an attestation without an account or trusting Aperture's servers. */
export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <Logo href="/" />
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Verify an attestation</h1>
        <p className="text-muted-foreground">
          Drop in an attestation JSON file. Its signature is checked here, in your browser, against Aperture’s published keys.
          Add the period’s audit export to check the event range and Merkle root too.
        </p>
      </header>
      <AttestationVerifier />
    </main>
  );
}
