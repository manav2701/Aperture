'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { getSolanaConnection, getPolicyPDA, fetchPolicyAccountOnChain } from '@/lib/solana';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

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
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    async function loadAgents() {
      if (!publicKey) return;
      try {
        const connection = getSolanaConnection();
        const [pda] = getPolicyPDA(publicKey);
        const policyOnChain = await fetchPolicyAccountOnChain(connection, pda);

        if (policyOnChain) {
          setAgents([
            {
              id: pda.toBase58(),
              name: 'Connected Agent Wallet',
              pubkey: policyOnChain.agent.toBase58(),
              status: policyOnChain.isPaused ? 'PAUSED' : 'ACTIVE',
              dailyLimit: `${(policyOnChain.dailyLimit.toNumber() / 1_000_000_000).toFixed(2)} SOL`,
              perTxLimit: `${(policyOnChain.perTxLimit.toNumber() / 1_000_000_000).toFixed(2)} SOL`,
            },
          ]);
        } else {
          try {
            const { data } = await supabase
              .from('policies')
              .select('*')
              .eq('owner_address', publicKey.toBase58());

            if (data && data.length > 0) {
              setAgents(
                data.map((item: any, i: number) => ({
                  id: item.id || String(i),
                  name: `Agent Wallet ${i + 1}`,
                  pubkey: item.agent_address,
                  status: item.is_paused ? 'PAUSED' : 'ACTIVE',
                  dailyLimit: `${(item.daily_limit_stx / 1_000_000_000).toFixed(2)} SOL`,
                  perTxLimit: `${(item.per_tx_limit_stx / 1_000_000_000).toFixed(2)} SOL`,
                }))
              );
            } else {
              setAgents([]);
            }
          } catch {
            setAgents([]);
          }
        }
      } catch (err) {
        console.warn('Error fetching agents:', err);
        setAgents([]);
      } finally {
        setLoading(false);
      }
    }

    loadAgents();
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
            Connect your wallet to manage autonomous AI agent wallets
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-background">
        <div>
          <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[FLEET]</span>
          <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
            REGISTERED AI AGENTS HUB
          </h1>
          <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
            ACTIVE AI AGENT WALLETS, ON-CHAIN POLICY LINKAGE, AND STATUS CONTROLS
          </p>
        </div>

        <Link
          href="/policies"
          className="kinetic-btn-primary px-6 py-3 text-xs tracking-tighter self-start sm:self-auto"
        >
          [+] ADD AGENT POLICY
        </Link>
      </div>

      {/* Agents List */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto mb-4" />
          <p className="text-xs font-mono text-accent uppercase tracking-widest animate-pulse">
            LOADING REGISTERED AGENTS...
          </p>
        </div>
      ) : agents.length > 0 ? (
        <div className="space-y-4">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="kinetic-card p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-mono text-xl font-bold tracking-tighter uppercase">{agent.name}</h3>
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
                <div className="text-xs font-mono text-mutedForeground flex items-center gap-2">
                  <span>PUBKEY:</span>
                  <span className="text-foreground font-bold">{agent.pubkey}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <div className="px-4 py-2 bg-muted border border-border">
                  <span className="text-[10px] font-mono text-mutedForeground block uppercase tracking-widest">DAILY CAP</span>
                  <span className="text-sm font-mono font-bold text-accent">{agent.dailyLimit}</span>
                </div>

                <div className="px-4 py-2 bg-muted border border-border">
                  <span className="text-[10px] font-mono text-mutedForeground block uppercase tracking-widest">PER-TX CAP</span>
                  <span className="text-sm font-mono font-bold text-foreground">{agent.perTxLimit}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-2 border-border p-12 text-center space-y-4 bg-background">
          <div className="text-3xl font-mono text-accent font-bold">[!]</div>
          <h3 className="font-mono text-xl font-bold text-foreground uppercase tracking-tighter">
            NO REGISTERED AI AGENT POLICIES FOUND
          </h3>
          <p className="text-xs font-mono text-mutedForeground max-w-md mx-auto uppercase">
            Initialize your first agent policy in the Policy Manager tab to register AI agent wallets under your owner authority.
          </p>
          <div className="pt-2">
            <Link
              href="/policies"
              className="kinetic-btn-primary px-8 py-4 text-xs tracking-tighter"
            >
              CREATE FIRST AGENT POLICY
            </Link>
          </div>
        </div>
      )}

    </div>
  );
}
