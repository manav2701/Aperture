'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { formatSol } from '@/lib/solana';
import { HiOfficeBuilding, HiServer, HiChartBar, HiShieldCheck } from 'react-icons/hi';

export const dynamic = 'force-dynamic';

interface AgentCompanyStats {
  agent_address: string;
  totalSpentSol: number;
  dailyLimitSol: number;
  status: 'ACTIVE' | 'PAUSED' | 'LIMIT_REACHED';
  lastActivity: string;
}

export default function CompanyDashboard() {
  const { isConnected } = useWallet();
  const [agents, setAgents] = useState<AgentCompanyStats[]>([
    {
      agent_address: '7fCoCyErkSmyzFP1Rf6HKQuVJzmbpk31PwJVDsScnVPi',
      totalSpentSol: 10.0,
      dailyLimitSol: 100.0,
      status: 'ACTIVE',
      lastActivity: '2 mins ago',
    },
    {
      agent_address: '3M2a1pWk7fCoCyErkSmyzFP1Rf6HKQuVJzmbpk31P',
      totalSpentSol: 50.0,
      dailyLimitSol: 50.0,
      status: 'LIMIT_REACHED',
      lastActivity: '15 mins ago',
    },
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

          <div className="divide-y divide-slate-800">
            {agents.map((agent, i) => {
              const util = Math.min((agent.totalSpentSol / agent.dailyLimitSol) * 100, 100);
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
                    <span className="text-[10px] font-mono text-slate-500 block">Last activity: {agent.lastActivity}</span>
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
        </div>

      </div>
    </div>
  );
}
