'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { getSolanaConnection, getPolicyPDA, fetchPolicyAccountOnChain } from '@/lib/solana';
import { HiChartBar, HiExclamationCircle } from 'react-icons/hi';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface DelegationNode {
  id: string;
  name: string;
  pubkey: string;
  depth: number;
  delegatedBudgetSol: number;
  spentSol: number;
  canRedelegate: boolean;
}

export default function DelegationPage() {
  const { isConnected, publicKey } = useWallet();
  const [nodes, setNodes] = useState<DelegationNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    async function loadDelegationTree() {
      if (!publicKey) return;
      try {
        const connection = getSolanaConnection();
        const [pda] = getPolicyPDA(publicKey);
        const policyOnChain = await fetchPolicyAccountOnChain(connection, pda);

        if (policyOnChain && policyOnChain.delegatedBudget && policyOnChain.delegatedBudget.toNumber() > 0) {
          setNodes([
            {
              id: pda.toBase58(),
              name: 'Connected Orchestrator Agent',
              pubkey: policyOnChain.agent.toBase58(),
              depth: policyOnChain.delegationDepth || 0,
              delegatedBudgetSol: (policyOnChain.delegatedBudget?.toNumber() || 0) / 1_000_000_000,
              spentSol: policyOnChain.spentToday.toNumber() / 1_000_000_000,
              canRedelegate: policyOnChain.canRedelegate || false,
            },
          ]);
        } else {
          setNodes([]);
        }
      } catch (err) {
        console.warn('Error loading delegation tree:', err);
        setNodes([]);
      } finally {
        setLoading(false);
      }
    }

    loadDelegationTree();
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
            Connect your wallet to inspect agent budget delegation trees
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
        {loading ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-400 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-xs font-mono text-slate-400">Querying delegation tree on-chain...</p>
          </div>
        ) : nodes.length > 0 ? (
          <div className="space-y-4">
            {nodes.map((node) => {
              const utilPct = Math.min((node.spentSol / (node.delegatedBudgetSol || 1)) * 100, 100);
              return (
                <div
                  key={node.id}
                  className="p-6 bg-slate-900/90 border border-purple-500/40 rounded-2xl backdrop-blur-xl shadow-xl shadow-purple-950/20"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/30">
                          Depth {node.depth} • Orchestrator Node
                        </span>
                        <h3 className="font-mono text-base font-bold text-slate-200">{node.name}</h3>
                      </div>

                      <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                        <span className="text-slate-500">Pubkey:</span>
                        <span className="text-cyan-400">{node.pubkey}</span>
                      </div>
                    </div>

                    <div className="w-full md:w-64 space-y-2">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-slate-400">Delegated Budget Utilized</span>
                        <span className="text-purple-400 font-bold">{utilPct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                        <div
                          className="bg-gradient-to-r from-purple-400 to-indigo-500 h-full"
                          style={{ width: `${utilPct}%` }}
                        />
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 text-right">
                        {node.spentSol.toFixed(2)} / {node.delegatedBudgetSol.toFixed(2)} SOL
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
            <HiExclamationCircle className="w-12 h-12 text-purple-400 mx-auto" />
            <h3 className="font-mono text-lg font-bold text-purple-400 uppercase tracking-wider">
              No Active Budget Delegation Trees Found
            </h3>
            <p className="text-xs font-mono text-slate-400 max-w-md mx-auto">
              Delegation trees allow master orchestrator agents to slice and allocate sub-budgets to sub-agents on-chain. Configure delegation parameters in your policy account to visualize budget flow.
            </p>
            <Link
              href="/policies"
              className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-mono font-bold text-xs rounded-xl transition-all uppercase tracking-wider shadow-lg shadow-purple-600/20"
            >
              CONFIGURE POLICY DELEGATION
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}
