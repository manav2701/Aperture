'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** A secret shown exactly once after creation, with a copy button. */
export function SecretOnce({ label, secret, onDone }: { label: string; secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-3 border border-accent p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">
        Copy it now. Aperture stores only a fingerprint and can never show it again.
      </p>
      <code className="block overflow-x-auto break-all bg-muted px-3 py-2 font-mono text-sm">{secret}</code>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(secret).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          I’ve saved it
        </Button>
      </div>
    </div>
  );
}
