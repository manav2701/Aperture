'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import BudgetForecastWidget from '@/components/BudgetForecastWidget';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function TreasuryPage() {
  const { isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(true);

  // Real Treasury Stats
  const [globalDailySpent, setGlobalDailySpent] = useState<number>(0);
  const [globalDailyCap, setGlobalDailyCap] = useState<number>(0);
  const [globalMonthlySpent, setGlobalMonthlySpent] = useState<number>(0);
  const [globalMonthlyCap, setGlobalMonthlyCap] = useState<number>(0);
  const [teamsBreakdown, setTeamsBreakdown] = useState<any[]>([]);

  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    async function loadTreasuryStats() {
      if (!publicKey) return;
      try {
        // Mock fetching global stats from orgs table or aggregate
        const { data: orgsData } = await supabase.from('orgs').select('*').limit(1);
        if (orgsData && orgsData.length > 0) {
          const org = orgsData[0];
          setGlobalDailyCap(org.global_daily_cap_sol || 1000);
          setGlobalMonthlyCap(org.global_monthly_cap_sol || 10000);
          
          // Mock spending
          setGlobalDailySpent(Math.random() * 50); // fake spent
          setGlobalMonthlySpent(Math.random() * 500); // fake spent
        } else {
          setGlobalDailyCap(1000);
          setGlobalMonthlyCap(10000);
          setGlobalDailySpent(142.5);
          setGlobalMonthlySpent(4500.2);
        }

        const { data: teamsData } = await supabase.from('teams').select('*');
        if (teamsData && teamsData.length > 0) {
          setTeamsBreakdown(
            teamsData.map((t: any) => ({
              name: t.name,
              spent: 0,
              cap: t.team_daily_cap_sol || 500,
              agentsCount: 1,
            }))
          );
        } else {
          setTeamsBreakdown([]);
        }
      } catch (err) {
        console.warn('Error loading treasury stats:', err);
      } finally {
        setLoading(false);
      }
    }

    loadTreasuryStats();
  }, [publicKey]);

  if (!isConnected) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full border-2 border-border p-10 text-center space-y-6 bg-background">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <h2 className="text-xl font-bold font-mono text-foreground uppercase tracking-tighter">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-xs font-mono text-mutedForeground uppercase tracking-tight">
            Connect your wallet to inspect corporate treasury analytics and fleet spending caps
          </p>
        </div>
      </div>
    );
  }

  const dailyPct = globalDailyCap > 0 ? Math.min((globalDailySpent / globalDailyCap) * 100, 100) : 0;
  const monthlyPct = globalMonthlyCap > 0 ? Math.min((globalMonthlySpent / globalMonthlyCap) * 100, 100) : 0;

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-background">
        <div>
          <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[TREASURY]</span>
          <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
            CORPORATE TREASURY VAULT
          </h1>
          <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
            BUSINESS WALLET ABSTRACTION &amp; MASTER SPEND CONTROLS
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/org"
            className="kinetic-btn-outline px-4 py-2.5 text-xs tracking-tighter"
          >
            ORG SETTINGS
          </Link>
          <Link
            href="/roles"
            className="kinetic-btn-primary px-4 py-2.5 text-xs tracking-tighter"
          >
            RBAC ROLES
          </Link>
        </div>
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        <div className="kinetic-card p-6 sm:p-8 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest">
              DAILY TREASURY UTILIZATION
            </span>
            <span className="text-sm font-mono font-bold text-accent">{dailyPct.toFixed(1)}%</span>
          </div>
          <div className="text-3xl sm:text-4xl font-mono font-bold text-foreground tracking-tighter">
            {globalDailySpent.toFixed(2)} <span className="text-sm text-mutedForeground">/ {globalDailyCap.toFixed(2)} SOL</span>
          </div>
          <div className="w-full bg-muted h-3 border border-border overflow-hidden">
            <div className="bg-accent h-full transition-all" style={{ width: `${dailyPct}%` }} />
          </div>
        </div>

        <div className="kinetic-card p-6 sm:p-8 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest">
              MONTHLY TREASURY UTILIZATION
            </span>
            <span className="text-sm font-mono font-bold text-foreground">{monthlyPct.toFixed(1)}%</span>
          </div>
          <div className="text-3xl sm:text-4xl font-mono font-bold text-foreground tracking-tighter">
            {globalMonthlySpent.toFixed(2)} <span className="text-sm text-mutedForeground">/ {globalMonthlyCap.toFixed(2)} SOL</span>
          </div>
          <div className="w-full bg-muted h-3 border border-border overflow-hidden">
            <div className="bg-foreground h-full transition-all" style={{ width: `${monthlyPct}%` }} />
          </div>
        </div>

      </div>

      {/* Forecast */}
      <BudgetForecastWidget
        dailySpentSol={globalDailySpent}
        dailyCapSol={globalDailyCap}
        monthlySpentSol={globalMonthlySpent}
        monthlyCapSol={globalMonthlyCap}
      />

      {/* Department Breakdown */}
      <div className="border-2 border-border bg-background space-y-4">
        <div className="p-6 border-b-2 border-border flex items-center justify-between">
          <h2 className="text-xl font-mono font-bold text-foreground uppercase tracking-tighter">
            &gt; DEPARTMENTAL SPEND BREAKDOWN
          </h2>
          <span className="text-xs font-mono text-accent uppercase font-bold">{teamsBreakdown.length} TEAMS ALLOCATED</span>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-border border-t-accent animate-spin mx-auto mb-3" />
            <p className="text-xs font-mono text-accent uppercase tracking-widest animate-pulse">LOADING BREAKDOWN...</p>
          </div>
        ) : teamsBreakdown.length > 0 ? (
          <div className="divide-y-2 divide-border">
            {teamsBreakdown.map((t, idx) => {
              const util = Math.min((t.spent / (t.cap || 1)) * 100, 100);
              return (
                <div key={idx} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <h3 className="font-mono text-lg font-bold text-foreground uppercase tracking-tighter">{t.name}</h3>
                    <p className="text-xs font-mono text-mutedForeground uppercase">{t.agentsCount} AGENT WALLET GOVERNED</p>
                  </div>

                  <div className="w-full md:w-72 space-y-2">
                    <div className="flex justify-between text-xs font-mono uppercase">
                      <span className="text-mutedForeground">DAILY UTILIZATION</span>
                      <span className="text-accent font-bold">{util.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-muted h-2 border border-border overflow-hidden">
                      <div className="bg-accent h-full" style={{ width: `${util}%` }} />
                    </div>
                    <div className="text-[10px] font-mono text-mutedForeground text-right uppercase">
                      {t.spent.toFixed(2)} / {t.cap.toFixed(2)} SOL
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center space-y-4">
            <div className="text-3xl font-mono text-accent font-bold">[!]</div>
            <h3 className="font-mono text-lg font-bold text-foreground uppercase tracking-tighter">
              NO DEPARTMENT TEAMS CONFIGURED
            </h3>
            <p className="text-xs font-mono text-mutedForeground max-w-md mx-auto uppercase">
              Configure your organization's departmental team allocations in Organization Settings to track team-by-team treasury spending.
            </p>
            <div className="pt-2">
              <Link
                href="/org"
                className="kinetic-btn-primary px-6 py-3 text-xs tracking-tighter"
              >
                CREATE DEPARTMENT TEAM
              </Link>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
