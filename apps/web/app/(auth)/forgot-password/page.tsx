'use client';

import { useState, useTransition, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input } from '@/components/ui/form';
import { authClient } from '@/lib/auth-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
      if (failure === null) setSent(true);
      else setError(failure.message ?? 'Could not send the reset email.');
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-2xl font-bold">Reset your password</h1>
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      {sent ? <FormNotice>If an account exists for {email}, a reset link is on its way.</FormNotice> : null}
      <Button type="submit" className="w-full" disabled={pending || sent}>
        Send reset link
      </Button>
    </form>
  );
}
