'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { errorMessage } from './api/browser';

/**
 * Runs an API call from a form: tracks pending state, shows the API's error message, and
 * refreshes server components on success so lists re-render with the new data.
 */
export function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (call: () => Promise<{ error?: unknown; response: Response }>, onSuccess?: () => void) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await call();
        if (!result.response.ok) {
          setError(errorMessage(result.error));
          return;
        }
        onSuccess?.();
        router.refresh();
      } catch {
        setError('Could not reach Aperture. Check your connection and try again.');
      }
    });
  };

  return { submit, pending, error, setError };
}
