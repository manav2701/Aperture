'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { getSolanaConnection, getPolicyPDA, fetchPolicyAccountOnChain } from '@/lib/solana';
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
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full border-2 border-border p-10 text-center space-y-6 bg-background">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <h2 className="text-xl font-bold font-mono text-foreground uppercase tracking-tighter">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-xs font-mono text-mutedForeground uppercase tracking-tight">
            Connect your wallet to inspect agent budget delegation trees
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[DELEGATION TREE]</span>
        <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
          BUDGET DELEGATION VISUALIZER
        </h1>
        <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
          AXIS-6 BUDGET DELEGATION &amp; HIERARCHICAL ORCHESTRATOR-TO-SUBAGENT FLOW
        </p>
      </div>

      {/* Tree View */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <h2 className="text-xl font-mono font-bold text-foreground uppercase tracking-tighter border-b-2 border-border pb-4">
          &gt; DELEGATION NODES
        </h2>

        {loading ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto mb-4" />
            <p className="text-xs font-mono text-accent uppercase tracking-widest animate-pulse">
              QUERYING DELEGATION TREE ON-CHAIN...
            </p>
          </div>
        ) : nodes.length > 0 ? (
          <div className="space-y-4">
            {nodes.map((node) => {
              const utilPct = Math.min((node.spentSol / (node.delegatedBudgetSol || 1)) * 100, 100);
              return (
                <div key={node.id} className="kinetic-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 bg-accent text-accentForeground font-mono text-xs font-bold uppercase tracking-widest border border-accent">
                        DEPTH {node.depth} • ORCHESTRATOR NODE
                      </span>
                      <h3 className="font-mono text-base font-bold uppercase tracking-tight">{node.name}</h3>
                    </div>

                    <p className="text-xs font-mono text-mutedForeground uppercase">
                      PUBKEY: <span className="text-foreground font-bold">{node.pubkey}</span>
                    </p>
                  </div>

                  <div className="w-full md:w-64 space-y-2">
                    <div className="flex justify-between text-xs font-mono uppercase">
                      <span className="text-mutedForeground">DELEGATED UTILIZATION</span>
                      <span className="text-accent font-bold">{utilPct.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-muted h-2 border border-border overflow-hidden">
                      <div className="bg-accent h-full" style={{ width: `${utilPct}%` }} />
                    </div>
                    <div className="text-[10px] font-mono text-mutedForeground text-right uppercase">
                      {node.spentSol.toFixed(2)} / {node.delegatedBudgetSol.toFixed(2)} SOL
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
              NO ACTIVE BUDGET DELEGATION TREES FOUND
            </h3>
            <p className="text-xs font-mono text-mutedForeground max-w-md mx-auto uppercase">
              Delegation trees allow master orchestrator agents to slice and allocate sub-budgets to sub-agents on-chain.
            </p>
            <div className="pt-2">
              <Link
                href="/policies"
                className="kinetic-btn-primary px-8 py-4 text-xs tracking-tighter"
              >
                CONFIGURE POLICY DELEGATION
              </Link>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
