'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface AgentCompanyStats {
  agent_address: string;
  totalSpentSol: number;
  dailyLimitSol: number;
  status: 'ACTIVE' | 'PAUSED' | 'LIMIT_REACHED';
  lastActivity: string;
}

export default function CompanyDashboard() {
  const { isConnected, publicKey } = useWallet();
  const [agents, setAgents] = useState<AgentCompanyStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    async function loadCompanyData() {
      if (!publicKey) return;
      try {
        const { data: policies } = await supabase
          .from('policies')
          .select('*')
          .eq('owner_address', publicKey.toBase58());

        if (policies && policies.length > 0) {
          setAgents(
            policies.map((p: any) => ({
              agent_address: p.agent_address,
              totalSpentSol: (p.spent_today || 0) / 1_000_000_000,
              dailyLimitSol: (p.daily_limit_stx || 100_000_000_000) / 1_000_000_000,
              status: p.is_paused ? 'PAUSED' : 'ACTIVE',
              lastActivity: 'ACTIVE',
            }))
          );
        } else {
          setAgents([]);
        }
      } catch (err) {
        console.warn('Error loading company data:', err);
        setAgents([]);
      } finally {
        setLoading(false);
      }
    }

    loadCompanyData();
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
            Connect your wallet to monitor enterprise AI agent fleet metrics
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[FLEET MONITOR]</span>
        <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
          ENTERPRISE AGENT FLEET MONITOR
        </h1>
        <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
          ORGANIZATION-WIDE SPENDING ANALYTICS, UTILIZATION, AND COMPLIANCE ACROSS FLEET WALLETS
        </p>
      </div>

      {/* Fleet Overview */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold text-foreground uppercase tracking-tighter">
            &gt; AGENT FLEET OVERVIEW
          </h2>
          <span className="text-xs font-mono text-accent font-bold uppercase">{agents.length} ACTIVE WALLETS</span>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto mb-4" />
            <p className="text-xs font-mono text-accent uppercase tracking-widest animate-pulse">
              LOADING FLEET ANALYTICS...
            </p>
          </div>
        ) : agents.length > 0 ? (
          <div className="divide-y-2 divide-border">
            {agents.map((agent, i) => {
              const util = Math.min((agent.totalSpentSol / (agent.dailyLimitSol || 1)) * 100, 100);
              return (
                <div key={i} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-muted transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-base font-bold text-foreground uppercase tracking-tight">{agent.agent_address}</span>
                      <span
                        className={`text-[10px] font-mono px-3 py-1 font-bold uppercase tracking-widest border-2 ${
                          agent.status === 'ACTIVE'
                            ? 'bg-accent text-accentForeground border-accent'
                            : 'bg-destructive text-foreground border-destructive'
                        }`}
                      >
                        {agent.status}
                      </span>
                    </div>
                  </div>

                  <div className="w-full md:w-64 space-y-2">
                    <div className="flex justify-between text-xs font-mono uppercase">
                      <span className="text-mutedForeground">DAILY UTILIZATION</span>
                      <span className="text-accent font-bold">{util.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-muted h-2 border border-border overflow-hidden">
                      <div className="bg-accent h-full" style={{ width: `${util}%` }} />
                    </div>
                    <div className="text-[10px] font-mono text-mutedForeground text-right uppercase">
                      {agent.totalSpentSol.toFixed(2)} / {agent.dailyLimitSol.toFixed(2)} SOL
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
              NO ENTERPRISE AGENT FLEET CONFIGURED
            </h3>
            <p className="text-xs font-mono text-mutedForeground max-w-md mx-auto uppercase">
              Configure your organization's AI agent wallet policies to monitor fleet spending and compliance metrics here.
            </p>
            <div className="pt-2">
              <Link
                href="/policies"
                className="kinetic-btn-primary px-8 py-4 text-xs tracking-tighter"
              >
                INITIALIZE AGENT FLEET
              </Link>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
