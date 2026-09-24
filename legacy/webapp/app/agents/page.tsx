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
  virtualKey?: string;
  status: 'ACTIVE' | 'PAUSED';
  dailyLimit: string;
  perTxLimit: string;
  allowedModels?: string[];
}

export default function AgentsPage() {
  const { isConnected, publicKey } = useWallet();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(true);

  // New Agent Modal state
  const [showModal, setShowModal] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [dailyCapUsd, setDailyCapUsd] = useState('100');
  const [perTxCapUsd, setPerTxCapUsd] = useState('10');
  const [selectedModels, setSelectedModels] = useState<string[]>(['openai/gpt-4o', 'anthropic/claude-3-5-sonnet']);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function loadAgents() {
      try {
        const agentList: AgentItem[] = [];

        // 1. Load On-Chain Solana Agents
        if (publicKey) {
          try {
            const connection = getSolanaConnection();
            const [pda] = getPolicyPDA(publicKey);
            const policyOnChain = await fetchPolicyAccountOnChain(connection, pda);

            if (policyOnChain) {
              agentList.push({
                id: pda.toBase58(),
                name: 'On-Chain Solana Agent',
                pubkey: policyOnChain.agent.toBase58(),
                status: policyOnChain.isPaused ? 'PAUSED' : 'ACTIVE',
                dailyLimit: `${(policyOnChain.dailyLimit.toNumber() / 1_000_000_000).toFixed(2)} SOL`,
                perTxLimit: `${(policyOnChain.perTxLimit.toNumber() / 1_000_000_000).toFixed(2)} SOL`,
              });
            }
          } catch (e) {
            console.warn('Solana on-chain check error:', e);
          }
        }

        // 2. Load Virtual API Key Agents from Supabase/DB
        const { data: dbVirtualKeys } = await supabase
          .from('agent_virtual_keys')
          .select('*')
          .order('created_at', { ascending: false });

        if (dbVirtualKeys && dbVirtualKeys.length > 0) {
          dbVirtualKeys.forEach((item: any) => {
            agentList.push({
              id: item.id,
              name: item.agent_address ? `Agent (${item.agent_address.slice(0, 8)})` : 'Governed Gateway Agent',
              pubkey: item.agent_address || 'Virtual Key Agent',
              virtualKey: item.virtual_api_key,
              status: 'ACTIVE',
              dailyLimit: `$${item.daily_limit_usd || 100} USD`,
              perTxLimit: `$${item.per_tx_limit_usd || 10} USD`,
              allowedModels: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet', 'google/gemini-pro']
            });
          });
        }

        setAgents(agentList);
      } catch (err) {
        console.warn('Error fetching agents:', err);
        setAgents([]);
      } finally {
        setLoading(false);
      }
    }

    loadAgents();
  }, [publicKey]);

  const handleCreateVirtualAgent = async () => {
    if (!agentName) return;
    setCreating(true);
    try {
      const newVirtualKey = `aptr_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
      const walletAddress = publicKey ? publicKey.toBase58() : `wallet_${Math.random().toString(36).slice(2, 8)}`;

      await supabase.from('agent_virtual_keys').insert({
        agent_address: walletAddress,
        virtual_api_key: newVirtualKey,
        daily_limit_usd: parseFloat(dailyCapUsd),
        per_tx_limit_usd: parseFloat(perTxCapUsd),
        velocity_max_per_hour: 60,
      });

      setGeneratedKey(newVirtualKey);
      setAgents([
        {
          id: String(Date.now()),
          name: agentName,
          pubkey: walletAddress,
          virtualKey: newVirtualKey,
          status: 'ACTIVE',
          dailyLimit: `$${dailyCapUsd} USD`,
          perTxLimit: `$${perTxCapUsd} USD`,
          allowedModels: selectedModels
        },
        ...agents
      ]);
    } catch (err) {
      console.error('Failed to create virtual agent:', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-background">
        <div>
          <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[FLEET]</span>
          <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
            REGISTERED AI AGENTS &amp; GATEWAY KEYS
          </h1>
          <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
            ACTIVE AI AGENT WALLETS, GOVERNED VIRTUAL API KEYS, AND POLICY CONTROLS
          </p>
        </div>

        <button
          onClick={() => { setShowModal(true); setGeneratedKey(null); }}
          className="kinetic-btn-primary px-6 py-3 text-xs tracking-tighter self-start sm:self-auto"
        >
          [+] GENERATE GOVERNED VIRTUAL KEY
        </button>
      </div>

      {/* Virtual Key Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-background border-2 border-border p-8 max-w-lg w-full space-y-6">
            <h2 className="text-xl font-mono font-bold uppercase tracking-tighter border-b-2 border-border pb-3">
              GENERATE APERTURE VIRTUAL API KEY
            </h2>

            {generatedKey ? (
              <div className="space-y-4">
                <div className="p-4 bg-accent/10 border-2 border-accent text-accent">
                  <span className="text-[10px] font-mono block uppercase font-bold">VIRTUAL AGENT API KEY (SAVE SECURELY)</span>
                  <code className="text-sm font-mono font-bold break-all block mt-1">{generatedKey}</code>
                </div>
                <p className="text-xs font-mono text-mutedForeground">
                  Agents use this key in their OpenAI client Authorization header: <br/>
                  <code className="text-accent">Authorization: Bearer {generatedKey}</code>
                </p>
                <button
                  onClick={() => setShowModal(false)}
                  className="kinetic-btn-primary w-full py-3 text-xs tracking-tighter"
                >
                  DONE
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-mono text-mutedForeground block mb-1">AGENT IDENTIFIER / NAME</label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g. TradingBot-Alpha"
                    className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-mono text-mutedForeground block mb-1">DAILY CAP ($ USD)</label>
                    <input
                      type="number"
                      value={dailyCapUsd}
                      onChange={(e) => setDailyCapUsd(e.target.value)}
                      className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-mutedForeground block mb-1">PER-TX CAP ($ USD)</label>
                    <input
                      type="number"
                      value={perTxCapUsd}
                      onChange={(e) => setPerTxCapUsd(e.target.value)}
                      className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleCreateVirtualAgent}
                    disabled={creating || !agentName}
                    className="kinetic-btn-primary flex-1 py-3 text-xs tracking-tighter"
                  >
                    {creating ? 'GENERATING...' : 'GENERATE KEY'}
                  </button>
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-3 border-2 border-border text-xs font-mono uppercase font-bold"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

                {agent.virtualKey && (
                  <div className="text-xs font-mono text-accent flex items-center gap-2">
                    <span>VIRTUAL KEY:</span>
                    <span className="font-bold border border-accent/40 px-2 py-0.5 bg-accent/5">
                      {agent.virtualKey}
                    </span>
                  </div>
                )}

                <div className="text-xs font-mono text-mutedForeground flex items-center gap-2">
                  <span>IDENTIFIER / ADDRESS:</span>
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
            NO REGISTERED AI AGENT KEYS FOUND
          </h3>
          <p className="text-xs font-mono text-mutedForeground max-w-md mx-auto uppercase">
            Click above to generate your first Governed Virtual Agent API Key for OpenRouter proxying.
          </p>
        </div>
      )}
    </div>
  );
}
