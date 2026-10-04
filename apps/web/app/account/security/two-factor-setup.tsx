'use client';

import QRCode from 'qrcode';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input } from '@/components/ui/form';
import { authClient } from '@/lib/auth-client';

type Step = { kind: 'idle' } | { kind: 'scan'; qr: string; secret: string; backupCodes: string[] } | { kind: 'done' };

export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = () => {
    setError(null);
    startTransition(async () => {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error !== null) {
        setError(result.error.message ?? 'Could not start two-factor setup.');
        return;
      }
      if (result.data.method !== 'totp') {
        setError('Unexpected two-factor method.');
        return;
      }
      const secret = new URL(result.data.totpURI).searchParams.get('secret') ?? '';
      setStep({
        kind: 'scan',
        qr: await QRCode.toDataURL(result.data.totpURI),
        secret,
        backupCodes: result.data.backupCodes,
      });
    });
  };

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (result.error !== null) {
        setError(result.error.message ?? 'That code did not work.');
        return;
      }
      setPassword('');
      setCode('');
      setStep({ kind: 'done' });
      router.refresh();
    });
  };

  const disable = () => {
    setError(null);
    startTransition(async () => {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error !== null) setError(result.error.message ?? 'Could not turn it off.');
      else router.refresh();
    });
  };

  if (enabled || step.kind === 'done') {
    return (
      <div className="space-y-3">
        <FormNotice>Two-factor authentication is on.</FormNotice>
        <Field label="Password (to turn it off)" htmlFor="tf-password-off">
          <Input
            id="tf-password-off"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </Field>
        <FormError message={error} />
        <Button variant="danger" size="sm" disabled={pending || password === ''} onClick={disable}>
          Turn off two-factor
        </Button>
      </div>
    );
  }

  if (step.kind === 'scan') {
    return (
      <div className="space-y-4">
        <p className="text-sm">Scan this with an authenticator app (1Password, Google Authenticator, Authy…):</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL generated in the browser */}
        <img src={step.qr} alt="Two-factor QR code" width={192} height={192} className="bg-white p-2" />
        <p className="break-all font-mono text-xs text-muted-foreground">Or enter this key: {step.secret}</p>
        <div className="space-y-1">
          <p className="text-sm font-medium">Backup codes: each works once. Store them somewhere safe now.</p>
          <pre className="bg-muted p-3 font-mono text-xs">{step.backupCodes.join('\n')}</pre>
        </div>
        <Field label="Code from the app" htmlFor="tf-code">
          <Input
            id="tf-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
        </Field>
        <FormError message={error} />
        <Button disabled={pending || code.length < 6} onClick={confirm}>
          Confirm and turn on
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Two-factor authentication is off.</p>
      <Field label="Your password" htmlFor="tf-password">
        <Input
          id="tf-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      <Button disabled={pending || password === ''} onClick={start}>
        Set up two-factor
      </Button>
    </div>
  );
}
