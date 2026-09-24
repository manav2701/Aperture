'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, FormNotice, Input } from '@/components/ui/form';
import { authClient } from '@/lib/auth-client';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const withPassword = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.signIn.email({ email, password, callbackURL: next });
      if (failure === null) {
        router.push(next);
        return;
      }
      setError(
        failure.status === 403
          ? 'Verify your email first — we just sent you a new link.'
          : (failure.message ?? 'Email or password is incorrect.'),
      );
    });
  };

  const withMagicLink = () => {
    setError(null);
    if (email === '') {
      setError('Enter your email address first.');
      return;
    }
    startTransition(async () => {
      const { error: failure } = await authClient.signIn.magicLink({ email, callbackURL: next });
      if (failure === null) setNotice(`We sent a sign-in link to ${email}. It works for 5 minutes.`);
      else setError(failure.message ?? 'Could not send the link.');
    });
  };

  const withGoogle = () => {
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.signIn.social({ provider: 'google', callbackURL: next });
      if (failure !== null) setError(failure.message ?? 'Google sign-in is not available.');
    });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={withPassword} className="space-y-4">
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
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </Field>
        <FormError message={error} />
        {notice === null ? null : <FormNotice>{notice}</FormNotice>}
        <Button type="submit" className="w-full" disabled={pending}>
          Sign in
        </Button>
        <Link href="/forgot-password" className="block text-center text-sm text-muted-foreground hover:text-foreground">
          Forgot your password?
        </Link>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-3">
        <Button variant="secondary" className="w-full" disabled={pending} onClick={withMagicLink}>
          Email me a sign-in link
        </Button>
        <Button variant="secondary" className="w-full" disabled={pending} onClick={withGoogle}>
          Continue with Google
        </Button>
      </div>
    </div>
  );
}
