'use client';

import { useState, useEffect } from 'react';

// Force dynamic rendering to avoid prerender errors with Turbopack
export const dynamic = 'force-dynamic';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import { microSTXtoSTX, satoshisToBTC } from '@/lib/stacks';
import { format } from 'date-fns';

interface Session {
  id: string;
  session_id: string;
  agent_address: string;
  budget_stx: number;
  budget_sbtc: number;
  spent_stx: number;
  spent_sbtc: number;
  is_active: boolean;
  payment_count: number;
  expires_at: string;
  created_at: string;
}

export default function SessionsPage() {
  const { address, isConnected } = useWallet();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Form state
  const [budgetStx, setBudgetStx] = useState('5');
  const [budgetSbtc, setBudgetSbtc] = useState('0.5');
  const [timeoutHours, setTimeoutHours] = useState('1');

  useEffect(() => {
    if (!address) return;

    async function loadSessions() {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('agent_address', address)
        .order('created_at', { ascending: false });

      if (data) {
        setSessions(data);
      }
      setLoading(false);
    }

    loadSessions();

    // Real-time updates
    const channel = supabase
      .channel('session-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `agent_address=eq.${address}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setSessions(prev => [payload.new as Session, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setSessions(prev => 
              prev.map(s => s.id === payload.new.id ? payload.new as Session : s)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [address]);

  const handleCreateSession = async () => {
    if (!address) return;

    setCreating(true);
    try {
      const sessionId = `session-${Date.now()}`;
      const expiresAt = new Date(Date.now() + parseFloat(timeoutHours) * 3600000);

      const { data, error } = await supabase
        .from('sessions')
        .insert({
          session_id: sessionId,
          agent_address: address,
          owner_address: address,
          budget_stx: parseFloat(budgetStx) * 1_000_000,
          budget_sbtc: parseFloat(budgetSbtc) * 100_000_000,
          spent_stx: 0,
          spent_sbtc: 0,
          is_active: true,
          payment_count: 0,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (data) {
        alert('Session created successfully!');
        setBudgetStx('5');
        setBudgetSbtc('0.5');
        setTimeoutHours('1');
      }

      if (error) throw error;
    } catch (error) {
      console.error('Error creating session:', error);
      alert('Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const handleEndSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to end this session?')) return;

    try {
      await supabase
        .from('sessions')
        .update({ is_active: false })
        .eq('session_id', sessionId);

      alert('Session ended!');
    } catch (error) {
      console.error('Error ending session:', error);
      alert('Failed to end session');
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="font-mono text-2xl font-bold text-foreground mb-4 uppercase tracking-wider">{'> '}CONNECT WALLET</h2>
          <p className="font-mono text-mutedForeground uppercase tracking-wide">PLEASE CONNECT YOUR WALLET TO MANAGE SESSIONS</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-600">Loading sessions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background circuit-grid">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <div className="mb-8">
          <h1 className="font-mono text-4xl font-bold text-foreground mb-2 uppercase tracking-wider">{'> '}SESSION MANAGEMENT</h1>
          <p className="font-mono text-mutedForeground uppercase tracking-wide">CREATE SESSIONS TO BATCH MULTIPLE PAYMENTS WITH A SHARED BUDGET</p>
        </div>

        {/* Create Session Form */}
        <div className="bg-card cyber-chamfer border-2 border-border p-8 mb-8 shadow-neon-sm">
          <h2 className="font-mono text-2xl font-bold text-foreground mb-6 uppercase tracking-wider">{'> '}CREATE NEW SESSION</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Budget (STX)
              </label>
              <input
                type="number"
                value={budgetStx}
                onChange={(e) => setBudgetStx(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="5"
                step="0.000001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Budget (sBTC)
              </label>
              <input
                type="number"
                value={budgetSbtc}
                onChange={(e) => setBudgetSbtc(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="0.5"
                step="0.00000001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Timeout (hours)
              </label>
              <input
                type="number"
                value={timeoutHours}
                onChange={(e) => setTimeoutHours(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="1"
                step="0.5"
              />
            </div>
          </div>

          <button
            onClick={handleCreateSession}
            disabled={creating}
            className="w-full px-6 py-3 bg-linear-to-r from-orange-500 to-amber-500 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {creating ? 'Creating Session...' : 'Create Session'}
          </button>
        </div>

        {/* Sessions List */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-900">Your Sessions</h2>
          </div>

          {sessions.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-gray-500">No sessions created yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sessions.map((session) => {
                const stxUsed = (session.spent_stx / session.budget_stx) * 100;
                const sbtcUsed = (session.spent_sbtc / session.budget_sbtc) * 100;
                const isExpired = new Date(session.expires_at) < new Date();

                return (
                  <div key={session.id} className="px-6 py-6 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-bold text-gray-900">
                            {session.session_id}
                          </h3>
                          {session.is_active && !isExpired ? (
                            <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                              Active
                            </span>
                          ) : isExpired ? (
                            <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full">
                              Expired
                            </span>
                          ) : (
                            <span className="px-3 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
                              Ended
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 space-y-1">
                          <div>Created: {format(new Date(session.created_at), 'MMM d, yyyy HH:mm')}</div>
                          <div>Expires: {format(new Date(session.expires_at), 'MMM d, yyyy HH:mm')}</div>
                          <div>Payments: {session.payment_count}</div>
                        </div>
                      </div>

                      {session.is_active && !isExpired && (
                        <button
                          onClick={() => handleEndSession(session.session_id)}
                          className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition-colors"
                        >
                          End Session
                        </button>
                      )}
                    </div>

                    {/* Budget Progress */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* STX */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">STX Budget</span>
                          <span className="text-sm font-bold text-gray-900">
                            {microSTXtoSTX(session.spent_stx).toFixed(6)} / {microSTXtoSTX(session.budget_stx).toFixed(6)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-linear-to-r from-orange-500 to-amber-500 h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(stxUsed, 100)}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {stxUsed.toFixed(1)}% used
                        </div>
                      </div>

                      {/* sBTC */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">sBTC Budget</span>
                          <span className="text-sm font-bold text-gray-900">
                            {satoshisToBTC(session.spent_sbtc).toFixed(8)} / {satoshisToBTC(session.budget_sbtc).toFixed(8)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-linear-to-r from-yellow-500 to-amber-500 h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(sbtcUsed, 100)}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {sbtcUsed.toFixed(1)}% used
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}