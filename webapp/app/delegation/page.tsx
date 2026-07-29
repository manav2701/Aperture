'use client';

import { useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { HiChartBar, HiServer, HiChevronRight, HiPlus, HiShieldCheck } from 'react-icons/hi';

export const dynamic = 'force-dynamic';

interface DelegationNode {
  id: string;
  name: string;
  pubkey: string;
  depth: number;
  delegatedBudgetSol: number;
  spentSol: number;
  canRedelegate: boolean;
  children: DelegationNode[];
}

export default function DelegationPage() {
  const { isConnected } = useWallet();

  const [treeData] = useState<DelegationNode>({
    id: 'node-root',
    name: 'Orchestrator Agent Prime',
    pubkey: '7fCoCyErkSmyzFP1Rf6HKQuVJzmbpk31PwJVDsScnVPi',
    depth: 0,
    delegatedBudgetSol: 1000.0,
    spentSol: 240.0,
    canRedelegate: true,
    children: [
      {
        id: 'node-sub1',
        name: 'Sub-Agent: DEX Arbitrage Execution',
        pubkey: '3M2a1pWk7fCoCyErkSmyzFP1Rf6HKQuVJzmbpk31P',
        depth: 1,
        delegatedBudgetSol: 300.0,
        spentSol: 150.0,
        canRedelegate: false,
        children: [],
      },
      {
        id: 'node-sub2',
        name: 'Sub-Agent: Liquidity Provisioning',
        pubkey: '8Y4b9qRs1mK3vW1mP2rT5K9x8zLqP2rT5K9x8zLq',
        depth: 1,
        delegatedBudgetSol: 200.0,
        spentSol: 90.0,
        canRedelegate: false,
        children: [],
      },
    ],
  });

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-10 text-center shadow-2xl shadow-cyan-950/30">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-bold font-mono text-cyan-400 mb-3 uppercase tracking-wider">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-slate-400 text-xs font-mono mb-6 leading-relaxed">
            Connect your wallet to inspect agent budget delegation trees
          </p>
        </div>
      </div>
    );
  }

  const renderNode = (node: DelegationNode) => {
    const utilPct = Math.min((node.spentSol / node.delegatedBudgetSol) * 100, 100);

    return (
      <div key={node.id} className="space-y-4">
        <div
          className={`p-6 rounded-2xl backdrop-blur-xl border transition-all ${
            node.depth === 0
              ? 'bg-slate-900/90 border-cyan-500/40 shadow-xl shadow-cyan-950/20'
              : 'bg-slate-950/80 border-purple-500/30 ml-8 sm:ml-12'
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                    node.depth === 0
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                      : 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
                  }`}
                >
                  Depth {node.depth} {node.depth === 0 ? '• Master Orchestrator' : '• Sub-Agent'}
                </span>
                <h3 className="font-mono text-base font-bold text-slate-200">{node.name}</h3>
              </div>

              <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                <span className="text-slate-500">Pubkey:</span>
                <span className="text-cyan-400">{node.pubkey.slice(0, 8)}...{node.pubkey.slice(-6)}</span>
              </div>
            </div>

            <div className="w-full md:w-64 space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">Delegated Budget Utilized</span>
                <span className="text-cyan-400 font-bold">{utilPct.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-cyan-400 to-purple-500 h-full"
                  style={{ width: `${utilPct}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 text-right">
                {node.spentSol.toFixed(2)} / {node.delegatedBudgetSol.toFixed(2)} SOL
              </div>
            </div>
          </div>
        </div>

        {node.children.map((child) => renderNode(child))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-purple-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-purple-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiChartBar className="w-8 h-8 text-purple-400" />
            <h1 className="text-2xl font-black font-mono text-purple-400 uppercase tracking-wider">
              BUDGET DELEGATION TREE VISUALIZER
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Aperture v3 Axis-6 Budget Delegation • Real-Time Hierarchical Orchestrator-to-Subagent Spend Flow
          </p>
        </div>

        {/* Tree Container */}
        <div className="space-y-4">
          {renderNode(treeData)}
        </div>

      </div>
    </div>
  );
}
