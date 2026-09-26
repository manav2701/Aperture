'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-renders the page every few seconds while something is still running. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, seconds * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [router, seconds]);
  return (
    <p role="status" className="text-xs text-muted-foreground">
      Checking for finished videos every {seconds} seconds…
    </p>
  );
}
