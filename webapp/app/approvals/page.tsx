'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface PendingApproval {
  id: string;
  source: 'SOLANA_PAYMENT' | 'LLM_GATEWAY';
  agentName: string;
  agentAddress: string;
  amountOrCost: string;
  recipientOrModel: string;
  reason: string;
  timestamp: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
}

export default function ApprovalsPage() {
  const { isConnected, publicKey } = useWallet();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);

  useEffect(() => {
    async function loadApprovals() {
      try {
        const combinedApprovals: PendingApproval[] = [];

        // 1. Solana Payment Escalations
        if (publicKey) {
          const { data: solData } = await supabase
            .from('payment_history')
            .select('*')
            .eq('owner_address', publicKey.toBase58())
            .eq('status', 'PENDING_APPROVAL');

          if (solData && solData.length > 0) {
            solData.forEach((item: any) => {
              combinedApprovals.push({
                id: item.id,
                source: 'SOLANA_PAYMENT',
                agentName: 'Solana Agent Wallet',
                agentAddress: item.agent_address,
                amountOrCost: `${((item.amount || 0) / 1_000_000_000).toFixed(2)} SOL`,
                recipientOrModel: item.recipient_address || 'Contract Account',
                reason: item.reason || 'Escalation threshold reached',
                timestamp: new Date(item.created_at).toLocaleTimeString(),
                status: 'PENDING',
              });
            });
          }
        }

        // 2. Governed OpenRouter LLM Gateway Escalations
        const { data: llmData } = await supabase
          .from('agent_request_logs')
          .select('*')
          .eq('status', 'ESCALATED_PENDING');

        if (llmData && llmData.length > 0) {
          llmData.forEach((item: any) => {
            combinedApprovals.push({
              id: item.id,
              source: 'LLM_GATEWAY',
              agentName: item.virtual_api_key ? `${item.virtual_api_key.slice(0, 14)}...` : 'AI Agent',
              agentAddress: item.virtual_api_key || 'Virtual Key',
              amountOrCost: `$${(item.cost_usd || 0.05).toFixed(4)} USD`,
              recipientOrModel: item.model_slug || 'openai/gpt-4o',
              reason: item.blocked_reason || 'LLM cost exceeded escalation threshold',
              timestamp: new Date(item.created_at).toLocaleTimeString(),
              status: 'PENDING',
            });
          });
        }

        setApprovals(combinedApprovals);
      } catch (err) {
        console.warn('Error loading approvals:', err);
        setApprovals([]);
      } finally {
        setLoading(false);
      }
    }

    loadApprovals();
  }, [publicKey]);

  const handleApprove = async (id: string, source: 'SOLANA_PAYMENT' | 'LLM_GATEWAY') => {
    setLoadingId(id);
    try {
      if (source === 'LLM_GATEWAY') {
        await supabase
          .from('agent_request_logs')
          .update({ status: 'ESCALATED_APPROVED', approved_by: publicKey ? publicKey.toBase58() : 'CFO Admin' })
          .eq('id', id);
      }
      setApprovals(approvals.map((a) => (a.id === id ? { ...a, status: 'APPROVED' } : a)));
    } catch (err) {
      console.error('Approve error:', err);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDeny = async (id: string, source: 'SOLANA_PAYMENT' | 'LLM_GATEWAY') => {
    setLoadingId(id);
    try {
      if (source === 'LLM_GATEWAY') {
        await supabase
          .from('agent_request_logs')
          .update({ status: 'ESCALATED_DENIED' })
          .eq('id', id);
      }
      setApprovals(approvals.map((a) => (a.id === id ? { ...a, status: 'DENIED' } : a)));
    } catch (err) {
      console.error('Deny error:', err);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[APPROVALS]</span>
        <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
          TRANSACTION &amp; GATEWAY ESCALATION QUEUE
        </h1>
        <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
          HUMAN-IN-THE-LOOP SAFEGUARDS FOR SOLANA TRANSFERS &amp; HIGH-COST LLM REQUESTS
        </p>
      </div>

      {/* Approvals List */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold text-foreground uppercase tracking-tighter">
            &gt; ESCALATED AGENT REQUESTS
          </h2>
          <span className="text-xs font-mono text-accent font-bold uppercase">{approvals.length} PENDING REVIEW</span>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-border border-t-accent animate-spin mx-auto mb-3" />
            <p className="text-xs font-mono text-accent uppercase tracking-widest animate-pulse">QUERYING ESCALATED QUEUE...</p>
          </div>
        ) : approvals.length > 0 ? (
          <div className="space-y-4 pt-2">
            {approvals.map((item) => (
              <div
                key={item.id}
                className="kinetic-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="font-mono text-lg font-bold uppercase tracking-tighter">{item.agentName}</h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 border border-border text-mutedForeground">
                      {item.source}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-3 py-1 font-bold uppercase tracking-widest border-2 ${
                        item.status === 'PENDING'
                          ? 'bg-accent text-accentForeground border-accent'
                          : item.status === 'APPROVED'
                          ? 'bg-foreground text-background border-foreground'
                          : 'bg-destructive text-foreground border-destructive'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>

                  <p className="text-xs font-mono text-mutedForeground uppercase">
                    REASON: <span className="text-foreground">{item.reason}</span>
                  </p>
                  <p className="text-[11px] font-mono text-mutedForeground uppercase">
                    TARGET: {item.recipientOrModel} • IDENTIFIER: {item.agentAddress}
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-2xl font-mono font-bold text-accent block tracking-tighter">{item.amountOrCost}</span>
                    <span className="text-[10px] font-mono text-mutedForeground block uppercase">{item.timestamp}</span>
                  </div>

                  {item.status === 'PENDING' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApprove(item.id, item.source)}
                        disabled={loadingId === item.id}
                        className="kinetic-btn-primary px-4 py-2 text-xs tracking-tighter"
                      >
                        [✓] APPROVE
                      </button>
                      <button
                        onClick={() => handleDeny(item.id, item.source)}
                        disabled={loadingId === item.id}
                        className="px-4 py-2 bg-destructive text-foreground hover:bg-foreground hover:text-background font-mono font-bold text-xs uppercase tracking-tighter border-2 border-destructive transition-all"
                      >
                        [X] DENY
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-xs font-mono text-mutedForeground uppercase tracking-widest italic">
            NO PENDING TRANSACTION OR GATEWAY APPROVAL ESCALATIONS FOUND.
          </div>
        )}
      </div>
    </div>
  );
}
