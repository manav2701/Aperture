'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import {
  getSolanaConnection,
  getPolicyPDA,
  getSessionPDA,
  fetchSessionAccountOnChain,
  SessionAccountData,
} from '@/lib/solana';

export const dynamic = 'force-dynamic';

export default function SessionsPage() {
  const { isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [sessionData, setSessionData] = useState<SessionAccountData | null>(null);

  // Session Form State
  const [sessionBudgetSol, setSessionBudgetSol] = useState('50');
  const [durationHours, setDurationHours] = useState('24');
  const [autoRenew, setAutoRenew] = useState(true);

  useEffect(() => {
    if (!publicKey) return;

    async function loadActiveSession() {
      if (!publicKey) return;
      try {
        const connection = getSolanaConnection();
        const [pda] = getPolicyPDA(publicKey);
        const [sessPDA] = getSessionPDA(pda);

        const onChainSession = await fetchSessionAccountOnChain(connection, sessPDA);
        setSessionData(onChainSession);
      } catch (err) {
        console.warn('Session query error:', err);
      }
    }

    loadActiveSession();
  }, [publicKey]);

  const handleOpenSession = async () => {
    if (!isConnected) {
      alert('Please connect your Solana wallet first');
      return;
    }

    setLoading(true);
    try {
      alert(`Instruction prepared to open autonomous session budget of ${sessionBudgetSol} SOL on Solana.`);
    } catch (err) {
      console.error('Session error:', err);
      alert('Failed to open session budget');
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full border-2 border-border p-10 text-center space-y-6 bg-background">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <h2 className="text-xl font-bold font-mono text-foreground uppercase tracking-tighter">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-xs font-mono text-mutedForeground uppercase tracking-tight">
            Connect your wallet to manage agent session sub-budgets
          </p>
        </div>
      </div>
    );
  }

  const budgetNum = sessionData ? sessionData.budget.toNumber() / 1_000_000_000 : 0;
  const spentNum = sessionData ? sessionData.spent.toNumber() / 1_000_000_000 : 0;
  const remainingNum = Math.max(budgetNum - spentNum, 0);

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[SESSIONS]</span>
        <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
          SESSION BUDGET MANAGER
        </h1>
        <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
          TIME-BOUNDED SESSION SUB-BUDGETS WITH DYNAMIC DEDUCTION &amp; AUTO-RENEWAL
        </p>
      </div>

      {/* Active Session Card */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold text-accent uppercase tracking-tighter">
            &gt; ACTIVE SESSION BUDGET
          </h2>
          <span
            className={`text-xs px-3 py-1 font-bold font-mono uppercase tracking-widest border-2 ${
              sessionData
                ? 'bg-accent text-accentForeground border-accent'
                : 'bg-muted text-mutedForeground border-border'
            }`}
          >
            {sessionData ? 'ON-CHAIN ACTIVE' : 'NO SESSION ACTIVE'}
          </span>
        </div>

        {sessionData ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="kinetic-card p-5">
              <span className="text-[10px] font-mono text-mutedForeground uppercase tracking-widest block mb-1">
                ALLOCATED BUDGET
              </span>
              <span className="text-2xl font-mono font-bold text-accent">{budgetNum.toFixed(2)} SOL</span>
            </div>

            <div className="kinetic-card p-5">
              <span className="text-[10px] font-mono text-mutedForeground uppercase tracking-widest block mb-1">
                SPENT / REMAINING
              </span>
              <span className="text-2xl font-mono font-bold text-foreground">
                {spentNum.toFixed(2)} / {remainingNum.toFixed(2)} SOL
              </span>
            </div>

            <div className="kinetic-card p-5">
              <span className="text-[10px] font-mono text-mutedForeground uppercase tracking-widest block mb-1">
                AUTO-RENEWAL STATUS
              </span>
              <span className="text-2xl font-mono font-bold text-accent uppercase">
                {sessionData.autoRenew ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-8 bg-muted border-2 border-border text-center space-y-2">
            <div className="text-2xl font-mono text-accent font-bold">[!]</div>
            <h3 className="font-mono text-sm font-bold text-foreground uppercase tracking-tighter">
              NO ACTIVE SESSION SUB-BUDGET FOUND
            </h3>
            <p className="text-xs font-mono text-mutedForeground max-w-md mx-auto uppercase">
              Open a time-bounded sub-budget below to grant your autonomous agent spending allocation.
            </p>
          </div>
        )}

        {/* Form */}
        <div className="pt-6 border-t-2 border-border space-y-6">
          <h3 className="text-lg font-mono font-bold text-foreground uppercase tracking-tighter">
            OPEN NEW SESSION SUB-BUDGET
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
                SESSION BUDGET AMOUNT (SOL)
              </label>
              <input
                type="number"
                value={sessionBudgetSol}
                onChange={(e) => setSessionBudgetSol(e.target.value)}
                placeholder="50.00"
                className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
                DURATION (HOURS)
              </label>
              <input
                type="number"
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                placeholder="24"
                className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="autoRenew"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
              className="w-4 h-4 rounded-none bg-muted border-2 border-border text-accent focus:ring-0"
            />
            <label htmlFor="autoRenew" className="text-xs font-mono text-foreground uppercase tracking-wide">
              ENABLE AUTO-RENEWAL WHEN SESSION BUDGET FALLS BELOW 10%
            </label>
          </div>

          <button
            onClick={handleOpenSession}
            disabled={loading}
            className="kinetic-btn-primary w-full py-4 text-sm tracking-tighter"
          >
            OPEN SESSION SUB-BUDGET ON-CHAIN
          </button>
        </div>
      </div>

    </div>
  );
}