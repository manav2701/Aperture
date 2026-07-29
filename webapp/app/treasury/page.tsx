'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import { HiOfficeBuilding, HiChartBar, HiShieldCheck } from 'react-icons/hi';
import BudgetForecastWidget from '@/components/BudgetForecastWidget';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function TreasuryPage() {
  const { isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(true);

  // Treasury Stats
  const [globalDailySpent, setGlobalDailySpent] = useState<number>(120.5);
  const [globalDailyCap, setGlobalDailyCap] = useState<number>(1000.0);
  const [globalMonthlySpent, setGlobalMonthlySpent] = useState<number>(2450.0);
  const [globalMonthlyCap, setGlobalMonthlyCap] = useState<number>(10000.0);

  const [teamsBreakdown, setTeamsBreakdown] = useState<any[]>([
    { name: 'Trading & Arbitrage Ops', spent: 85.5, cap: 500.0, agentsCount: 3 },
    { name: 'DeFi Liquidity Rebalancing', spent: 35.0, cap: 300.0, agentsCount: 2 },
    { name: 'Treasury Yield Optimization', spent: 0.0, cap: 200.0, agentsCount: 1 },
  ]);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-10 text-center shadow-2xl shadow-cyan-950/30">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-bold font-mono text-cyan-400 mb-3 uppercase tracking-wider">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-slate-400 text-xs font-mono mb-6 leading-relaxed">
            Connect your wallet to inspect master corporate treasury analytics and fleet spending caps
          </p>
        </div>
      </div>
    );
  }

  const dailyPct = Math.min((globalDailySpent / globalDailyCap) * 100, 100);
  const monthlyPct = Math.min((globalMonthlySpent / globalMonthlyCap) * 100, 100);

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header Banner */}
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-cyan-950/30 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <HiOfficeBuilding className="w-8 h-8 text-cyan-400" />
              <h1 className="text-2xl font-black font-mono text-cyan-400 uppercase tracking-wider">
                CORPORATE TREASURY DASHBOARD
              </h1>
            </div>
            <p className="text-slate-400 font-mono text-xs">
              Aperture v3 Business Wallet Abstraction • Master Treasury Spend & Departmental Controls
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/org"
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-purple-500/30 text-purple-300 font-mono font-bold text-xs rounded-xl transition-all uppercase tracking-wider"
            >
              ORG SETTINGS
            </Link>
            <Link
              href="/roles"
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-emerald-500/30 text-emerald-300 font-mono font-bold text-xs rounded-xl transition-all uppercase tracking-wider"
            >
              RBAC ROLES
            </Link>
          </div>
        </div>

        {/* Global Treasury Spending Gauges */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-6 backdrop-blur-xl space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                Global Daily Treasury Utilization
              </span>
              <span className="text-sm font-mono font-bold text-cyan-400">{dailyPct.toFixed(1)}%</span>
            </div>
            <div className="text-3xl font-mono font-bold text-slate-100">
              {globalDailySpent.toFixed(2)} <span className="text-sm font-normal text-slate-500">/ {globalDailyCap.toFixed(2)} SOL</span>
            </div>
            <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-cyan-400 to-blue-500 h-full transition-all"
                style={{ width: `${dailyPct}%` }}
              />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-purple-500/20 rounded-2xl p-6 backdrop-blur-xl space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                Global Monthly Treasury Utilization
              </span>
              <span className="text-sm font-mono font-bold text-purple-400">{monthlyPct.toFixed(1)}%</span>
            </div>
            <div className="text-3xl font-mono font-bold text-slate-100">
              {globalMonthlySpent.toFixed(2)} <span className="text-sm font-normal text-slate-500">/ {globalMonthlyCap.toFixed(2)} SOL</span>
            </div>
            <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all"
                style={{ width: `${monthlyPct}%` }}
              />
            </div>
          </div>

        </div>

        {/* Budget Forecast Widget */}
        <BudgetForecastWidget
          dailySpentSol={globalDailySpent}
          dailyCapSol={globalDailyCap}
          monthlySpentSol={globalMonthlySpent}
          monthlyCapSol={globalMonthlyCap}
        />

        {/* Team Department Breakdown */}
        <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl overflow-hidden backdrop-blur-xl">
          <div className="p-6 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-mono font-bold text-cyan-400 uppercase tracking-wider">
              &gt; Departmental Spend Breakdown
            </h2>
            <span className="text-xs font-mono text-slate-500">{teamsBreakdown.length} teams allocated</span>
          </div>

          <div className="divide-y divide-slate-800">
            {teamsBreakdown.map((t, idx) => {
              const util = Math.min((t.spent / t.cap) * 100, 100);
              return (
                <div key={idx} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <h3 className="font-mono text-sm font-bold text-slate-200">{t.name}</h3>
                    <p className="text-xs font-mono text-slate-500">{t.agentsCount} AI Agents Governed</p>
                  </div>

                  <div className="w-full md:w-72 space-y-2">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-400">Daily Cap Utilized</span>
                      <span className="text-cyan-400 font-bold">{util.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="bg-gradient-to-r from-cyan-400 to-indigo-500 h-full"
                        style={{ width: `${util}%` }}
                      />
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 text-right">
                      {t.spent.toFixed(2)} / {t.cap.toFixed(2)} SOL
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
