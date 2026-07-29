'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import EmergencyControls from '@/components/EmergencyControls';
import BudgetForecastWidget from '@/components/BudgetForecastWidget';
import {
  getSolanaConnection,
  getPolicyPDA,
  getSessionPDA,
  fetchPolicyAccountOnChain,
  fetchSessionAccountOnChain,
  PolicyAccountData,
  SessionAccountData,
} from '@/lib/solana';
import { supabase } from '@/lib/supabase';
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

        const onChainPolicy = await fetchPolicyAccountOnChain(connection, pda);
        setPolicyData(onChainPolicy);

        if (onChainPolicy) {
          const [sessPDA] = getSessionPDA(pda);
          const onChainSession = await fetchSessionAccountOnChain(connection, sessPDA);
          setSessionData(onChainSession);
        }

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
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full border-2 border-border p-10 text-center space-y-6 bg-background">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <h2 className="text-xl font-bold font-mono text-foreground uppercase tracking-tighter">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-xs font-mono text-mutedForeground uppercase tracking-tight">
            Connect your Solana Devnet wallet (Phantom / Solflare / MetaMask) to access the Aperture policy engine
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <p className="text-accent font-mono text-xs uppercase tracking-widest animate-pulse">
            QUERYING SOLANA DEVNET RPC &amp; ON-CHAIN ACCOUNTS...
          </p>
        </div>
      </div>
    );
  }

  const dailySpentNum = policyData ? policyData.spentToday.toNumber() / 1_000_000_000 : 0;
  const dailyLimitNum = policyData ? policyData.dailyLimit.toNumber() / 1_000_000_000 : 0;
  const spentPct = dailyLimitNum > 0 ? Math.min((dailySpentNum / dailyLimitNum) * 100, 100) : 0;

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-10">
      
      {/* High-Impact Header Section */}
      <div className="border-2 border-border p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-background">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 bg-accent animate-pulse" />
            <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter">
              SOLANA AGENT TREASURY DASHBOARD
            </h1>
          </div>
          <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest">
            REAL-TIME TOKEN-2022 TRANSFER HOOK ENFORCEMENT &amp; SESSION BUDGET MANAGEMENT
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="px-4 py-2 bg-muted border-2 border-border">
            <span className="text-[10px] font-mono text-mutedForeground uppercase tracking-widest block">WALLET BALANCE</span>
            <span className="text-base font-mono font-bold text-accent">{solBalance} SOL</span>
          </div>
          <div className="px-4 py-2 bg-muted border-2 border-border">
            <span className="text-[10px] font-mono text-mutedForeground uppercase tracking-widest block">POLICY PDA</span>
            <span className="text-xs font-mono font-bold text-foreground">
              {policyPDA ? `${policyPDA.slice(0, 6)}...${policyPDA.slice(-4)}` : 'DERIVED'}
            </span>
          </div>
        </div>
      </div>

      {/* Warning Banner if No On-Chain Policy */}
      {!policyData && (
        <div className="border-2 border-accent p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-muted">
          <div>
            <h3 className="font-mono text-sm font-bold text-accent uppercase tracking-tighter">
              NO ON-CHAIN POLICY DETECTED FOR CONNECTED WALLET
            </h3>
            <p className="text-xs font-mono text-mutedForeground mt-1 uppercase">
              Configure daily limits, per-tx caps, and recipient allowlists to activate transfer hook enforcement.
            </p>
          </div>
          <Link
            href="/policies"
            className="kinetic-btn-primary px-6 py-3 text-xs tracking-tighter whitespace-nowrap"
          >
            CONFIGURE POLICY NOW
          </Link>
        </div>
      )}

      {/* De-cluttered 4-Column Metric Grid with Massive Graphic Numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* Metric 01 */}
        <div className="kinetic-card p-6 relative overflow-hidden group">
          <span className="absolute -right-2 -bottom-6 text-[7rem] font-mono font-black text-muted/30 select-none group-hover:text-black/10 transition-colors">
            01
          </span>
          <div className="relative z-10 space-y-2">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">
              SINGLE TX CAP
            </span>
            <div className="text-3xl font-mono font-bold text-accent tracking-tighter">
              {policyData ? `${(policyData.perTxLimit.toNumber() / 1_000_000_000).toFixed(2)} SOL` : 'NOT SET'}
            </div>
            <p className="text-[10px] font-mono text-mutedForeground uppercase">MAX ALLOWED PER TRANSACTION</p>
          </div>
        </div>

        {/* Metric 02 */}
        <div className="kinetic-card p-6 relative overflow-hidden group">
          <span className="absolute -right-2 -bottom-6 text-[7rem] font-mono font-black text-muted/30 select-none group-hover:text-black/10 transition-colors">
            02
          </span>
          <div className="relative z-10 space-y-2">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">
              DAILY SPENT / LIMIT
            </span>
            <div className="text-3xl font-mono font-bold text-foreground tracking-tighter">
              {policyData ? `${dailySpentNum.toFixed(2)} / ${dailyLimitNum.toFixed(2)} SOL` : 'NOT SET'}
            </div>
            <div className="w-full bg-border h-2 border border-border mt-2 overflow-hidden">
              <div className="bg-accent h-full transition-all" style={{ width: `${spentPct}%` }} />
            </div>
          </div>
        </div>

        {/* Metric 03 */}
        <div className="kinetic-card p-6 relative overflow-hidden group">
          <span className="absolute -right-2 -bottom-6 text-[7rem] font-mono font-black text-muted/30 select-none group-hover:text-black/10 transition-colors">
            03
          </span>
          <div className="relative z-10 space-y-2">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">
              SESSION BUDGET
            </span>
            <div className="text-3xl font-mono font-bold text-accent tracking-tighter">
              {sessionData ? `${(sessionData.budget.toNumber() / 1_000_000_000).toFixed(2)} SOL` : 'NO SESSION'}
            </div>
            <p className="text-[10px] font-mono text-mutedForeground uppercase">
              {sessionData ? (sessionData.autoRenew ? 'AUTO-RENEW ENABLED' : 'AUTO-RENEW OFF') : 'SUB-BUDGET INACTIVE'}
            </p>
          </div>
        </div>

        {/* Metric 04 */}
        <div className="kinetic-card p-6 relative overflow-hidden group">
          <span className="absolute -right-2 -bottom-6 text-[7rem] font-mono font-black text-muted/30 select-none group-hover:text-black/10 transition-colors">
            04
          </span>
          <div className="relative z-10 space-y-2">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">
              TRANSFER HOOK STATUS
            </span>
            <div className={`text-2xl font-mono font-bold uppercase tracking-tighter ${
              policyData && !policyData.isPaused ? 'text-accent' : 'text-destructive'
            }`}>
              {policyData ? (policyData.isPaused ? 'PAUSED' : 'ACTIVE') : 'UNINITIALIZED'}
            </div>
            <p className="text-[10px] font-mono text-mutedForeground uppercase">ON-CHAIN TOKEN-2022 ENFORCEMENT</p>
          </div>
        </div>

      </div>

      {/* Core Action Grid (De-cluttered & High-Impact) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        <Link href="/policies" className="kinetic-card p-8 group">
          <div className="text-xs font-mono text-accent font-bold uppercase tracking-widest mb-2">[+] DEPLOY</div>
          <h3 className="font-mono text-2xl font-bold uppercase tracking-tighter mb-2">
            &gt; POLICY MANAGER
          </h3>
          <p className="text-xs font-mono text-mutedForeground leading-relaxed uppercase">
            CREATE, UPDATE, OR CONFIGURE DAILY SPENDING LIMITS, PER-TX CAPS, AND ALLOWLISTS.
          </p>
        </Link>

        <Link href="/sessions" className="kinetic-card p-8 group">
          <div className="text-xs font-mono text-accent font-bold uppercase tracking-widest mb-2">[+] ALLOCATE</div>
          <h3 className="font-mono text-2xl font-bold uppercase tracking-tighter mb-2">
            &gt; SESSION BUDGETS
          </h3>
          <p className="text-xs font-mono text-mutedForeground leading-relaxed uppercase">
            OPEN AUTONOMOUS AGENT SUB-BUDGETS WITH EXPIRATIONS AND AUTO-RENEWAL TRIGGERS.
          </p>
        </Link>

        <Link href="/audit" className="kinetic-card p-8 group">
          <div className="text-xs font-mono text-accent font-bold uppercase tracking-widest mb-2">[+] COMPLIANCE</div>
          <h3 className="font-mono text-2xl font-bold uppercase tracking-tighter mb-2">
            &gt; AUDIT LOGS
          </h3>
          <p className="text-xs font-mono text-mutedForeground leading-relaxed uppercase">
            INSPECT REAL-TIME TRANSFER HOOK EXECUTION LOGS, REJECTED TRANSACTIONS, AND CLAWBACKS.
          </p>
        </Link>

      </div>

      {/* Budget Forecast & Emergency Controls Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <BudgetForecastWidget />
        <EmergencyControls />
      </div>

    </div>
  );
}
