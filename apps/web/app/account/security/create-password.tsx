'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api } from '@/lib/api/browser';
import { useSubmit } from '@/lib/use-submit';

export function CreatePassword() {
  const { submit, pending, error, setError } = useSubmit();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== confirm) {
          setError('The passwords don’t match.');
          return;
        }
        submit(() => api.POST('/api/v1/me/password', { body: { newPassword: password } }));
      }}
    >
      <Field
        label="New password"
        htmlFor="new-password"
        hint="At least 12 characters. Store it in your password manager."
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </Field>
      <Field label="Repeat it" htmlFor="confirm-password">
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
          }}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        Create password
      </Button>
    </form>
  );
}
