'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface AuditItem {
  id: string;
  type: 'LLM_GATEWAY' | 'SOLANA_HOOK';
  txHash: string;
  agentName: string;
  amountOrCost: string;
  recipientOrModel: string;
  ruleExecuted: string;
  status: string;
  timestamp: string;
}

export default function AuditPage() {
  const { isConnected, publicKey } = useWallet();
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAuditLogs() {
      try {
        const combinedLogs: AuditItem[] = [];

        // 1. Load Solana Transfer Hook Payments
        if (publicKey) {
          const { data: solData } = await supabase
            .from('payment_history')
            .select('*')
            .eq('agent_address', publicKey.toBase58())
            .order('created_at', { ascending: false });

          if (solData) {
            solData.forEach((item: any) => {
              combinedLogs.push({
                id: item.id || String(Math.random()),
                type: 'SOLANA_HOOK',
                txHash: item.tx_id ? `${item.tx_id.slice(0, 8)}...${item.tx_id.slice(-6)}` : 'On-Chain Tx',
                agentName: 'Solana Agent Wallet',
                amountOrCost: `${(item.amount / 1_000_000_000).toFixed(2)} SOL`,
                recipientOrModel: item.recipient_address
                  ? `${item.recipient_address.slice(0, 6)}...${item.recipient_address.slice(-4)}`
                  : 'Contract Account',
                ruleExecuted: item.rule_executed || 'SPL Token-2022 Transfer Hook',
                status: item.status || 'APPROVED',
                timestamp: new Date(item.created_at).toLocaleTimeString(),
              });
            });
          }
        }

        // 2. Load Governed LLM Gateway Requests
        const { data: llmData } = await supabase
          .from('agent_request_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (llmData && llmData.length > 0) {
          llmData.forEach((item: any) => {
            combinedLogs.push({
              id: item.id,
              type: 'LLM_GATEWAY',
              txHash: item.tx_signature ? `${item.tx_signature.slice(0, 8)}...` : 'Virtual Key Gateway',
              agentName: item.virtual_api_key ? `${item.virtual_api_key.slice(0, 14)}...` : 'AI Agent',
              amountOrCost: `$${(item.cost_usd || 0).toFixed(4)}`,
              recipientOrModel: item.model_slug || 'openai/gpt-4o',
              ruleExecuted: `LLM Proxy (${item.input_tokens || 0} in / ${item.output_tokens || 0} out)`,
              status: item.status || 'APPROVED',
              timestamp: new Date(item.created_at).toLocaleTimeString(),
            });
          });
        }

        setLogs(combinedLogs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)));
      } catch (err) {
        console.warn('Error loading audit logs:', err);
        setLogs([]);
      } finally {
        setLoading(false);
      }
    }

    loadAuditLogs();
  }, [publicKey]);

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[AUDIT]</span>
        <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
          UNIFIED COMPLIANCE AUDIT LOGS
        </h1>
        <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
          SOLANA TOKEN-2022 TRANSFER HOOKS &amp; GOVERNED OPENROUTER LLM GATEWAY HISTORY
        </p>
      </div>

      {/* Audit Table */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold text-foreground uppercase tracking-tighter">
            &gt; REAL-TIME GOVERNANCE EVENT STREAM
          </h2>
          <span className="text-xs font-mono text-accent font-bold uppercase">{logs.length} EVENTS LOGGED</span>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto mb-4" />
            <p className="text-xs font-mono text-accent uppercase tracking-widest animate-pulse">
              QUERYING COMPLIANCE AUDIT LOGS...
            </p>
          </div>
        ) : logs.length > 0 ? (
          <div className="divide-y-2 divide-border">
            {logs.map((log) => (
              <div key={log.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted transition-colors">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[10px] font-mono px-3 py-1 font-bold uppercase tracking-widest border-2 ${
                        log.status.includes('APPROVED')
                          ? 'bg-accent text-accentForeground border-accent'
                          : log.status.includes('ESCALATED')
                          ? 'bg-amber-500 text-black border-amber-500'
                          : 'bg-destructive text-foreground border-destructive'
                      }`}
                    >
                      {log.status}
                    </span>
                    <span className="font-mono text-sm font-bold uppercase tracking-tight">{log.agentName}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 border border-border text-mutedForeground">
                      {log.type}
                    </span>
                  </div>

                  <p className="text-xs font-mono text-mutedForeground uppercase">
                    MODEL / RECIPIENT: <span className="text-foreground font-bold">{log.recipientOrModel}</span>
                  </p>
                  <p className="text-[11px] font-mono text-mutedForeground uppercase">
                    ACTION: {log.ruleExecuted} • IDENTIFIER: {log.txHash}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-xl font-mono font-bold text-accent block tracking-tighter">{log.amountOrCost}</span>
                  <span className="text-[10px] font-mono text-mutedForeground block uppercase">{log.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center space-y-3">
            <div className="text-3xl font-mono text-accent font-bold">[!]</div>
            <h3 className="font-mono text-lg font-bold text-foreground uppercase tracking-tighter">
              NO GOVERNED AUDIT EVENTS LOGGED YET
            </h3>
            <p className="text-xs font-mono text-mutedForeground max-w-md mx-auto uppercase">
              Compliance records populate here automatically when agents initiate LLM requests via Virtual API Keys or execute transfer-hook-gated transactions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}