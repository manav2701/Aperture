'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { getSolanaConnection, getPolicyPDA, fetchPolicyAccountOnChain } from '@/lib/solana';
import { supabase } from '@/lib/supabase';
import { HiServer, HiShieldCheck, HiExclamationCircle, HiPlus } from 'react-icons/hi';
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
          // Query Supabase for registered agent policies
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
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-cyan-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
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

          <Link
            href="/policies"
            className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs rounded-xl transition-all uppercase tracking-wider shadow-lg shadow-cyan-500/20 flex items-center gap-2 self-start sm:self-auto"
          >
            <HiPlus className="w-4 h-4" /> ADD AGENT POLICY
          </Link>
        </div>

        {/* Agents List */}
        {loading ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-xs font-mono text-slate-400">Loading registered agents...</p>
          </div>
        ) : agents.length > 0 ? (
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
        ) : (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
            <HiExclamationCircle className="w-12 h-12 text-cyan-400 mx-auto" />
            <h3 className="font-mono text-lg font-bold text-cyan-400 uppercase tracking-wider">
              No Registered AI Agent Policies Found
            </h3>
            <p className="text-xs font-mono text-slate-400 max-w-md mx-auto">
              Initialize your first agent policy in the Policy Manager tab to register AI agent wallets under your owner authority.
            </p>
            <Link
              href="/policies"
              className="inline-block px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs rounded-xl transition-all uppercase tracking-wider shadow-lg shadow-cyan-500/20"
            >
              CREATE FIRST AGENT POLICY
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}
