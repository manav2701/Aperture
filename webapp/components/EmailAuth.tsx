'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface EmailAuthProps {
  onSuccess?: () => void;
}

export default function EmailAuth({ onSuccess }: EmailAuthProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({ type: 'success', text: 'Account created! Check your email to confirm, then log in.' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSuccess?.();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Authentication failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-2 border-border p-6 bg-background space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setMode('login')}
          className={`flex-1 py-2 text-xs font-mono font-bold uppercase tracking-tighter border-2 transition-all ${
            mode === 'login' ? 'bg-accent text-accentForeground border-accent' : 'border-border text-mutedForeground hover:bg-muted'
          }`}
        >
          Sign In
        </button>
        <button
          onClick={() => setMode('signup')}
          className={`flex-1 py-2 text-xs font-mono font-bold uppercase tracking-tighter border-2 transition-all ${
            mode === 'signup' ? 'bg-accent text-accentForeground border-accent' : 'border-border text-mutedForeground hover:bg-muted'
          }`}
        >
          Create Account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          minLength={6}
          className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
        />

        {message && (
          <p className={`text-xs font-mono p-3 border ${
            message.type === 'error' ? 'border-destructive text-destructive bg-destructive/10' : 'border-accent text-accent bg-accent/10'
          }`}>
            {message.text}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="kinetic-btn-primary w-full py-3 text-xs tracking-tighter"
        >
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign In with Email' : 'Create Account'}
        </button>
      </form>
    </div>
  );
}
