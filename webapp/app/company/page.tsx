'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import { HiOfficeBuilding, HiExclamationCircle, HiShieldCheck } from 'react-icons/hi';
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
              lastActivity: 'Active',
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-10 text-center shadow-2xl shadow-cyan-950/30">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-bold font-mono text-cyan-400 mb-3 uppercase tracking-wider">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-slate-400 text-xs font-mono mb-6 leading-relaxed">
            Connect your wallet to monitor enterprise AI agent fleet metrics
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-cyan-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiOfficeBuilding className="w-8 h-8 text-cyan-400" />
            <h1 className="text-2xl font-black font-mono text-cyan-400 uppercase tracking-wider">
              ENTERPRISE AGENT FLEET MONITOR
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Organization-wide spending analytics, policy utilization, and transfer hook compliance across all agent wallets
          </p>
        </div>

        {/* Fleet Table */}
        <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl overflow-hidden backdrop-blur-xl">
          <div className="p-6 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-mono font-bold text-cyan-400 uppercase tracking-wider">
              &gt; Agent Fleet Overview
            </h2>
            <span className="text-xs font-mono text-slate-500">{agents.length} active wallets</span>
          </div>

          {loading ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-xs font-mono text-slate-400">Loading enterprise fleet analytics...</p>
            </div>
          ) : agents.length > 0 ? (
            <div className="divide-y divide-slate-800">
              {agents.map((agent, i) => {
                const util = Math.min((agent.totalSpentSol / (agent.dailyLimitSol || 1)) * 100, 100);
                return (
                  <div key={i} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-bold text-slate-200">{agent.agent_address}</span>
                        <span
                          className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold uppercase ${
                            agent.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                              : 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                          }`}
                        >
                          {agent.status}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 block">Status: {agent.lastActivity}</span>
                    </div>

                    <div className="w-full md:w-64 space-y-2">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-slate-400">Daily Utilization</span>
                        <span className="text-cyan-400 font-bold">{util.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                        <div
                          className="bg-gradient-to-r from-cyan-400 to-purple-500 h-full"
                          style={{ width: `${util}%` }}
                        />
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 text-right">
                        {agent.totalSpentSol.toFixed(2)} / {agent.dailyLimitSol.toFixed(2)} SOL
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center space-y-4">
              <HiExclamationCircle className="w-12 h-12 text-cyan-400 mx-auto" />
              <h3 className="font-mono text-lg font-bold text-cyan-400 uppercase tracking-wider">
                No Enterprise Agent Fleet Configured
              </h3>
              <p className="text-xs font-mono text-slate-400 max-w-md mx-auto">
                Configure your organization's AI agent wallet policies to monitor fleet spending and compliance metrics here.
              </p>
              <Link
                href="/policies"
                className="inline-block px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs rounded-xl transition-all uppercase tracking-wider shadow-lg shadow-cyan-500/20"
              >
                INITIALIZE AGENT FLEET
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
