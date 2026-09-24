'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { authClient } from '@/lib/auth-client';

const MIN_PASSWORD = 12;

export function SignupForm({ next, initialEmail }: { next: string; initialEmail: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${String(MIN_PASSWORD)} characters for your password.`);
      return;
    }
    startTransition(async () => {
      const { error: failure } = await authClient.signUp.email({ name, email, password, callbackURL: next });
      if (failure === null) router.push(`/check-email?email=${encodeURIComponent(email)}`);
      else setError(failure.message ?? 'Could not create the account.');
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Your name" htmlFor="name">
        <Input
          id="name"
          autoComplete="name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="Work email" htmlFor="email">
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
      <Field label="Password" htmlFor="password" hint={`At least ${String(MIN_PASSWORD)} characters.`}>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        Create account
      </Button>
    </form>
  );
}
