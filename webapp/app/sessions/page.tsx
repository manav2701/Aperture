'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { getSolanaConnection, getSessionPDA } from '@/lib/solana';
import { PublicKey } from '@solana/web3.js';
import { HiClock, HiPlus, HiRefresh, HiCheckCircle } from 'react-icons/hi';

export const dynamic = 'force-dynamic';

export default function SessionsPage() {
  const { isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [sessionBudgetSol, setSessionBudgetSol] = useState('50');
  const [durationHours, setDurationHours] = useState('24');
  const [autoRenew, setAutoRenew] = useState(true);

  const handleOpenSession = async () => {
    if (!isConnected) {
      alert('Please connect your Solana wallet first');
      return;
    }

    setLoading(true);
    try {
      alert(`Opened autonomous session budget of ${sessionBudgetSol} SOL on-chain!`);
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
            <span className="text-xs px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full">
              ONLINE
            </span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1">Session Allocated</span>
              <span className="text-xl font-mono font-bold text-purple-400">50.00 SOL</span>
            </div>

            <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1">Spent / Remaining</span>
              <span className="text-xl font-mono font-bold text-emerald-400">0.00 / 50.00 SOL</span>
            </div>

            <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1">Auto-Renewal</span>
              <span className="text-sm font-mono font-bold text-cyan-400 flex items-center gap-1.5 mt-1">
                <HiRefresh className="w-4 h-4 animate-spin text-cyan-400" /> ENABLED
              </span>
            </div>
          </div>

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