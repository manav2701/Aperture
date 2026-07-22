'use client';

import { useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { HiServer, HiCheck, HiPause, HiShieldCheck } from 'react-icons/hi';

export const dynamic = 'force-dynamic';

interface AgentItem {
  id: string;
  name: string;
  pubkey: string;
  status: 'ACTIVE' | 'PAUSED';
  dailyLimit: string;
  perTxLimit: string;
}

export default function AgentsPage() {
  const { isConnected, publicKey } = useWallet();
  const [agents, setAgents] = useState<AgentItem[]>([
    {
      id: '1',
      name: 'Arbitrage Agent Alpha',
      pubkey: '7fCoCyErkSmyzFP1Rf6HKQuVJzmbpk31PwJVDsScnVPi',
      status: 'ACTIVE',
      dailyLimit: '100.00 SOL',
      perTxLimit: '20.00 SOL',
    },
    {
      id: '2',
      name: 'Liquidity Rebalancer Bot',
      pubkey: '3M2a1pWk7fCoCyErkSmyzFP1Rf6HKQuVJzmbpk31P',
      status: 'ACTIVE',
      dailyLimit: '50.00 SOL',
      perTxLimit: '10.00 SOL',
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
            Connect your wallet to manage autonomous AI agent wallets
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-cyan-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiServer className="w-8 h-8 text-cyan-400" />
            <h1 className="text-2xl font-black font-mono text-cyan-400 uppercase tracking-wider">
              REGISTERED AI AGENTS HUB
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Overview of active AI agent wallets, Policy Account linkage, and status controls
          </p>
        </div>

        {/* Agents List */}
        <div className="space-y-4">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-6 backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-mono text-lg font-bold text-slate-200">{agent.name}</h3>
                  <span
                    className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                      agent.status === 'ACTIVE'
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                        : 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                    }`}
                  >
                    {agent.status}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                  <span className="text-slate-500">Pubkey:</span>
                  <span className="text-cyan-400">{agent.pubkey}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <span className="text-[10px] font-mono text-slate-500 block uppercase tracking-wider">Daily Cap</span>
                  <span className="text-sm font-mono font-bold text-slate-300">{agent.dailyLimit}</span>
                </div>

                <div>
                  <span className="text-[10px] font-mono text-slate-500 block uppercase tracking-wider">Per-Tx Cap</span>
                  <span className="text-sm font-mono font-bold text-slate-300">{agent.perTxLimit}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
