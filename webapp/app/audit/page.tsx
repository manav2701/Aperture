'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface AuditItem {
  id: string;
  txHash: string;
  agentName: string;
  amount: string;
  recipient: string;
  ruleExecuted: string;
  status: 'APPROVED' | 'REJECTED_CAP' | 'REJECTED_ALLOWLIST' | 'CLAWBACK';
  timestamp: string;
}

export default function AuditPage() {
  const { isConnected, publicKey } = useWallet();
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    async function loadAuditLogs() {
      if (!publicKey) return;
      try {
        const { data } = await supabase
          .from('payment_history')
          .select('*')
          .eq('agent_address', publicKey.toBase58())
          .order('created_at', { ascending: false });

        if (data && data.length > 0) {
          setLogs(
            data.map((item: any) => ({
              id: item.id || String(Math.random()),
              txHash: item.tx_id ? `${item.tx_id.slice(0, 8)}...${item.tx_id.slice(-6)}` : 'On-Chain Tx',
              agentName: 'Agent Wallet',
              amount: `${(item.amount / 1_000_000_000).toFixed(2)} SOL`,
              recipient: item.recipient_address
                ? `${item.recipient_address.slice(0, 6)}...${item.recipient_address.slice(-4)}`
                : 'Contract Account',
              ruleExecuted: item.rule_executed || 'SPL Token-2022 Transfer Hook Enforcement',
              status: item.status || 'APPROVED',
              timestamp: new Date(item.created_at).toLocaleTimeString(),
            }))
          );
        } else {
          setLogs([]);
        }
      } catch (err) {
        console.warn('Error loading audit logs:', err);
        setLogs([]);
      } finally {
        setLoading(false);
      }
    }

    loadAuditLogs();
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
            Connect your wallet to inspect transfer hook compliance audit logs
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[AUDIT]</span>
        <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
          COMPLIANCE AUDIT LOGS
        </h1>
        <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
          REAL-TIME TOKEN-2022 TRANSFER HOOK EXECUTION HISTORY &amp; RULE VERIFICATIONS
        </p>
      </div>

      {/* Audit Table */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold text-foreground uppercase tracking-tighter">
            &gt; TRANSFER HOOK AUDIT HISTORY
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
                        log.status === 'APPROVED'
                          ? 'bg-accent text-accentForeground border-accent'
                          : log.status === 'CLAWBACK'
                          ? 'bg-foreground text-background border-foreground'
                          : 'bg-destructive text-foreground border-destructive'
                      }`}
                    >
                      {log.status}
                    </span>
                    <span className="font-mono text-sm font-bold uppercase tracking-tight">{log.agentName}</span>
                  </div>

                  <p className="text-xs font-mono text-mutedForeground uppercase">
                    ACTION: <span className="text-foreground font-bold">{log.ruleExecuted}</span>
                  </p>
                  <p className="text-[11px] font-mono text-mutedForeground uppercase">
                    RECIPIENT: {log.recipient} • TX: {log.txHash}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-xl font-mono font-bold text-accent block tracking-tighter">{log.amount}</span>
                  <span className="text-[10px] font-mono text-mutedForeground block uppercase">{log.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center space-y-3">
            <div className="text-3xl font-mono text-accent font-bold">[!]</div>
            <h3 className="font-mono text-lg font-bold text-foreground uppercase tracking-tighter">
              NO AUDIT EVENTS LOGGED YET
            </h3>
            <p className="text-xs font-mono text-mutedForeground max-w-md mx-auto uppercase">
              Compliance event records automatically populate here when AI agents execute transfer-hook-gated transactions.
            </p>
          </div>
        )}
      </div>

    </div>
  );
}