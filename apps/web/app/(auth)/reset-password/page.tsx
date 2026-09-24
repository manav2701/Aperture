'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, useTransition, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { authClient } from '@/lib/auth-client';

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    token === null ? 'This reset link is invalid or has expired.' : null,
  );
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (token === null) return;
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.resetPassword({ newPassword: password, token });
      if (failure === null) router.push('/login');
      else setError(failure.message ?? 'Could not reset the password.');
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      <Field label="New password" htmlFor="password" hint="At least 12 characters.">
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || token === null}>
        Save password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
