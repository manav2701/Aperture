'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import EmergencyControls from '@/components/EmergencyControls';
import {
  getSolanaConnection,
  getPolicyPDA,
  getSessionPDA,
  fetchPolicyAccountOnChain,
  fetchSessionAccountOnChain,
  formatSol,
  PolicyAccountData,
  SessionAccountData,
} from '@/lib/solana';
import { supabase } from '@/lib/supabase';
import { PublicKey } from '@solana/web3.js';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface ActivityLog {
  id: string;
  txHash: string;
  amount: string;
  recipient: string;
  status: 'COMPLIANT' | 'REJECTED_CAP' | 'REJECTED_ALLOWLIST' | 'CLAWBACK';
  timestamp: string;
}

export default function Dashboard() {
  const { isConnected, publicKey } = useWallet();
  const [solBalance, setSolBalance] = useState<string>('0.00');
  const [policyPDA, setPolicyPDA] = useState<string>('');
  const [policyData, setPolicyData] = useState<PolicyAccountData | null>(null);
  const [sessionData, setSessionData] = useState<SessionAccountData | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!isConnected || !publicKey) {
      setLoading(false);
      return;
    }

    async function loadDashboardData() {
      if (!publicKey) return;
      try {
        const connection = getSolanaConnection();
        const balance = await connection.getBalance(publicKey);
        setSolBalance((balance / 1_000_000_000).toFixed(4));

        const [pda] = getPolicyPDA(publicKey);
        setPolicyPDA(pda.toBase58());

        // Fetch on-chain policy account
        const onChainPolicy = await fetchPolicyAccountOnChain(connection, pda);
        setPolicyData(onChainPolicy);

        // Fetch on-chain session account if policy exists
        if (onChainPolicy) {
          const [sessPDA] = getSessionPDA(pda);
          const onChainSession = await fetchSessionAccountOnChain(connection, sessPDA);
          setSessionData(onChainSession);
        }

        // Fetch real Supabase activity logs if available
        try {
          const { data: logsData } = await supabase
            .from('payment_history')
            .select('*')
            .eq('agent_address', publicKey.toBase58())
            .order('created_at', { ascending: false })
            .limit(10);

          if (logsData && logsData.length > 0) {
            setActivityLogs(
              logsData.map((item: any) => ({
                id: item.id || String(Math.random()),
                txHash: item.tx_id ? `${item.tx_id.slice(0, 6)}...${item.tx_id.slice(-4)}` : 'On-Chain',
                amount: `${(item.amount / 1_000_000_000).toFixed(2)} SOL`,
                recipient: item.recipient_address
                  ? `${item.recipient_address.slice(0, 6)}...${item.recipient_address.slice(-4)}`
                  : 'Contract',
                status: item.status || 'COMPLIANT',
                timestamp: new Date(item.created_at).toLocaleTimeString(),
              }))
            );
          } else {
            setActivityLogs([]);
          }
        } catch {
          setActivityLogs([]);
        }

        setLoading(false);
      } catch (err) {
        console.error('Error loading Solana dashboard data:', err);
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [isConnected, publicKey]);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-10 text-center shadow-2xl shadow-cyan-950/30">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-bold font-mono text-cyan-400 mb-3 uppercase tracking-wider">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-slate-400 text-xs font-mono mb-6 leading-relaxed">
            Connect your Solana wallet (Phantom / Solflare) to access the Aperture policy dashboard
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-cyan-400 font-mono text-xs uppercase tracking-widest animate-pulse">
            Querying Solana RPC Node & Accounts...
          </p>
        </div>
      </div>
    );
  }

  const dailySpentNum = policyData ? policyData.spentToday.toNumber() / 1_000_000_000 : 0;
  const dailyLimitNum = policyData ? policyData.dailyLimit.toNumber() / 1_000_000_000 : 0;
  const spentPct = dailyLimitNum > 0 ? Math.min((dailySpentNum / dailyLimitNum) * 100, 100) : 0;

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Banner */}
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-cyan-950/30 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-3 h-3 bg-emerald-400 rounded-full animate-ping" />
              <h1 className="text-2xl font-black font-mono text-cyan-400 uppercase tracking-wider">
                SOLANA AGENT POLICY DASHBOARD
              </h1>
            </div>
            <p className="text-slate-400 font-mono text-xs">
              Real-time SPL Token-2022 Transfer Hook Enforcement & Session Budget Manager
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="px-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Wallet Balance</span>
              <span className="text-sm font-mono font-bold text-emerald-400">{solBalance} SOL</span>
            </div>
            <div className="px-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Policy Account PDA</span>
              <span className="text-xs font-mono font-medium text-slate-300">
                {policyPDA ? `${policyPDA.slice(0, 6)}...${policyPDA.slice(-4)}` : 'Derived'}
              </span>
            </div>
          </div>
        </div>

        {/* Policy Status Warning if no policy on-chain */}
        {!policyData && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-mono text-sm font-bold text-amber-400 uppercase tracking-wider">
                NO ON-CHAIN POLICY FOUND FOR CONNECTED WALLET
              </h3>
              <p className="text-xs font-mono text-slate-400 mt-1">
                Configure your daily limits, per-tx caps, and recipient allowlists to enable SPL Token-2022 transfer hook controls.
              </p>
            </div>
            <Link
              href="/policies"
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs rounded-xl transition-all uppercase tracking-wider shadow-lg shadow-amber-500/20 whitespace-nowrap"
            >
              CONFIGURE POLICY
            </Link>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-6 backdrop-blur-xl">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
              Single Tx Cap
            </span>
            <span className="text-2xl font-mono font-bold text-cyan-400">
              {policyData ? `${(policyData.perTxLimit.toNumber() / 1_000_000_000).toFixed(2)} SOL` : 'Not Set'}
            </span>
            <span className="text-[10px] font-mono text-slate-500 block mt-2">Max allowed per transaction</span>
          </div>

          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-6 backdrop-blur-xl">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
              Daily Limit Spent
            </span>
            <span className="text-2xl font-mono font-bold text-purple-400">
              {policyData
                ? `${dailySpentNum.toFixed(2)} / ${dailyLimitNum.toFixed(2)} SOL`
                : 'Not Set'}
            </span>
            <div className="w-full bg-slate-950 h-2 rounded-full mt-3 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-cyan-400 to-purple-500 h-full transition-all"
                style={{ width: `${spentPct}%` }}
              />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-6 backdrop-blur-xl">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
              Session Budget
            </span>
            <span className="text-2xl font-mono font-bold text-emerald-400">
              {sessionData
                ? `${(sessionData.budget.toNumber() / 1_000_000_000).toFixed(2)} SOL`
                : 'No Active Session'}
            </span>
            <span className="text-[10px] font-mono text-emerald-500 block mt-2">
              {sessionData
                ? `Active • ${sessionData.autoRenew ? 'Auto-Renew Enabled' : 'Auto-Renew Off'}`
                : 'Open sub-budget in Sessions tab'}
            </span>
          </div>

          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-6 backdrop-blur-xl">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
              Transfer Hook Status
            </span>
            <span
              className={`text-lg font-mono font-bold flex items-center gap-2 ${
                policyData && !policyData.isPaused ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full animate-pulse ${
                  policyData && !policyData.isPaused ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              {policyData ? (policyData.isPaused ? 'PAUSED' : 'ACTIVE (TOKEN-2022)') : 'UNINITIALIZED'}
            </span>
            <span className="text-[10px] font-mono text-slate-500 block mt-2">On-Chain Policy Enforcement</span>
          </div>
        </div>

        {/* Quick Operations Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link
            href="/policies"
            className="p-6 bg-gradient-to-br from-slate-900 to-slate-900/60 border border-cyan-500/30 hover:border-cyan-400 rounded-2xl transition-all group"
          >
            <h3 className="font-mono text-lg font-bold text-cyan-400 group-hover:text-cyan-300 transition-colors uppercase tracking-wider mb-2">
              &gt; Policy Manager
            </h3>
            <p className="text-xs font-mono text-slate-400 leading-relaxed">
              Create, update, or configure daily spending limits, per-transaction caps, and recipient allowlists.
            </p>
          </Link>

          <Link
            href="/sessions"
            className="p-6 bg-gradient-to-br from-slate-900 to-slate-900/60 border border-purple-500/30 hover:border-purple-400 rounded-2xl transition-all group"
          >
            <h3 className="font-mono text-lg font-bold text-purple-400 group-hover:text-purple-300 transition-colors uppercase tracking-wider mb-2">
              &gt; Session Budgets
            </h3>
            <p className="text-xs font-mono text-slate-400 leading-relaxed">
              Open autonomous agent session sub-budgets with time expirations and auto-renewal triggers.
            </p>
          </Link>

          <Link
            href="/audit"
            className="p-6 bg-gradient-to-br from-slate-900 to-slate-900/60 border border-emerald-500/30 hover:border-emerald-400 rounded-2xl transition-all group"
          >
            <h3 className="font-mono text-lg font-bold text-emerald-400 group-hover:text-emerald-300 transition-colors uppercase tracking-wider mb-2">
              &gt; Compliance Audit Log
            </h3>
            <p className="text-xs font-mono text-slate-400 leading-relaxed">
              Monitor real-time transfer hook execution logs, rejected transaction attempts, and clawbacks.
            </p>
          </Link>
        </div>

        {/* Emergency Controls Section */}
        <EmergencyControls />

      </div>
    </div>
  );
}
