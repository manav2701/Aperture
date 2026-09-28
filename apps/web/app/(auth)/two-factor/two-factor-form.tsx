'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { authClient } from '@/lib/auth-client';

export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = backup
        ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: trust })
        : await authClient.twoFactor.verifyTotp({ code: code.trim(), trustDevice: trust });
      if (result.error === null) {
        router.push(next);
        return;
      }
      setError(result.error.message ?? 'That code did not work.');
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={backup ? 'Backup code' : 'Authenticator code'} htmlFor="code">
        <Input
          id="code"
          autoComplete="one-time-code"
          inputMode={backup ? 'text' : 'numeric'}
          required
          autoFocus
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
          }}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => {
            setTrust(e.target.checked);
          }}
        />
        Trust this device for 30 days
      </label>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Continue
      </Button>
      <button
        type="button"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => {
          setBackup(!backup);
          setCode('');
        }}
      >
        {backup ? 'Use the authenticator app instead' : 'Use a backup code instead'}
      </button>
    </form>
  );
}
