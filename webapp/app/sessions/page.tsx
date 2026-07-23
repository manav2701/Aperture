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
import { PublicKey } from '@solana/web3.js';
import { HiClock, HiPlus, HiRefresh, HiCheckCircle, HiExclamationCircle } from 'react-icons/hi';

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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-10 text-center shadow-2xl shadow-cyan-950/30">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-bold font-mono text-cyan-400 mb-3 uppercase tracking-wider">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-slate-400 text-xs font-mono mb-6 leading-relaxed">
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
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-purple-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-purple-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiClock className="w-8 h-8 text-purple-400" />
            <h1 className="text-2xl font-black font-mono text-purple-400 uppercase tracking-wider">
              SESSION TRACKER BUDGET MANAGER
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Open time-bounded session sub-budgets with dynamic CPI deduction and auto-renewal triggers
          </p>
        </div>

        {/* Active Session Status */}
        <div className="bg-slate-900/80 border border-purple-500/20 rounded-2xl p-8 backdrop-blur-xl space-y-6">
          <h2 className="text-lg font-mono font-bold text-purple-400 uppercase tracking-wider border-b border-slate-800 pb-3 flex items-center justify-between">
            <span>&gt; Active Session Budget</span>
            <span
              className={`text-xs px-3 py-1 border rounded-full ${
                sessionData
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              {sessionData ? 'ON-CHAIN ACTIVE' : 'NO ACTIVE SESSION'}
            </span>
          </h2>

          {sessionData ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1">
                  Allocated Budget
                </span>
                <span className="text-xl font-mono font-bold text-purple-400">{budgetNum.toFixed(2)} SOL</span>
              </div>

              <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1">
                  Spent / Remaining
                </span>
                <span className="text-xl font-mono font-bold text-emerald-400">
                  {spentNum.toFixed(2)} / {remainingNum.toFixed(2)} SOL
                </span>
              </div>

              <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1">
                  Auto-Renewal Status
                </span>
                <span className="text-sm font-mono font-bold text-cyan-400 flex items-center gap-1.5 mt-1">
                  {sessionData.autoRenew ? (
                    <>
                      <HiRefresh className="w-4 h-4 animate-spin text-cyan-400" /> ENABLED
                    </>
                  ) : (
                    'DISABLED'
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-6 bg-slate-950/60 border border-slate-800 rounded-xl text-center space-y-2">
              <HiExclamationCircle className="w-8 h-8 text-purple-400 mx-auto" />
              <h3 className="font-mono text-sm font-bold text-purple-300 uppercase tracking-wider">
                No Active Session Sub-Budget Found
              </h3>
              <p className="text-xs font-mono text-slate-400 max-w-md mx-auto">
                Open a time-bounded sub-budget below to grant your autonomous agent spending allocation for tasks.
              </p>
            </div>
          )}

          {/* Form */}
          <div className="pt-6 border-t border-slate-800 space-y-6">
            <h3 className="text-sm font-mono font-bold text-slate-300 uppercase tracking-wider">
              Open New Session Sub-Budget
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                  Session Budget Amount (SOL)
                </label>
                <input
                  type="number"
                  value={sessionBudgetSol}
                  onChange={(e) => setSessionBudgetSol(e.target.value)}
                  placeholder="50.00"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                  Duration (Hours)
                </label>
                <input
                  type="number"
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  placeholder="24"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="autoRenew"
                checked={autoRenew}
                onChange={(e) => setAutoRenew(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-purple-500 focus:ring-0"
              />
              <label htmlFor="autoRenew" className="text-xs font-mono text-slate-300 uppercase tracking-wider">
                Enable Auto-Renewal when session budget falls below 10%
              </label>
            </div>

            <button
              onClick={handleOpenSession}
              disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-mono font-black text-sm rounded-xl transition-all uppercase tracking-widest shadow-lg shadow-purple-600/20"
            >
              OPEN SESSION SUB-BUDGET ON-CHAIN
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}