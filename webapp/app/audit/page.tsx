'use client';

import { useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { HiDocumentText, HiShieldCheck, HiXCircle, HiCheckCircle, HiExclamation } from 'react-icons/hi';

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
  const { isConnected } = useWallet();
  const [logs] = useState<AuditItem[]>([
    {
      id: '1',
      txHash: '5K9x8zLqP2rT...vW1m',
      agentName: 'Arbitrage Agent Alpha',
      amount: '10.00 SOL',
      recipient: 'Approved Orca DEX Pool (7fCo...nVPi)',
      ruleExecuted: 'Transfer Hook Gated Check: Compliant',
      status: 'APPROVED',
      timestamp: '2 mins ago',
    },
    {
      id: '2',
      txHash: '3M2a1pWk9qRs...tY4n',
      agentName: 'Arbitrage Agent Alpha',
      amount: '50.00 SOL',
      recipient: 'Approved Orca DEX Pool (7fCo...nVPi)',
      ruleExecuted: 'Single Tx Cap Check: Exceeded (20 SOL max)',
      status: 'REJECTED_CAP',
      timestamp: '15 mins ago',
    },
    {
      id: '3',
      txHash: '8Y4b9qRs1mK3...zX9p',
      agentName: 'Liquidity Rebalancer Bot',
      amount: '5.00 SOL',
      recipient: 'Unauthorized Address (JAGd...3amM)',
      ruleExecuted: 'Recipient Allowlist Check: Not Allowlisted',
      status: 'REJECTED_ALLOWLIST',
      timestamp: '1 hour ago',
    },
    {
      id: '4',
      txHash: '2N7c4vB8xZ1q...mW5k',
      agentName: 'Arbitrage Agent Alpha',
      amount: '1000.00 SOL',
      recipient: 'Recovery Owner Wallet',
      ruleExecuted: 'Permanent Delegate Emergency Clawback',
      status: 'CLAWBACK',
      timestamp: '3 hours ago',
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
            Connect your wallet to inspect transfer hook compliance audit logs
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-emerald-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiDocumentText className="w-8 h-8 text-emerald-400" />
            <h1 className="text-2xl font-black font-mono text-emerald-400 uppercase tracking-wider">
              COMPLIANCE AUDIT LOGS
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Real-time SPL Token-2022 Transfer Hook execution history & compliance rule verifications
          </p>
        </div>

        {/* Audit Log Table */}
        <div className="bg-slate-900/80 border border-emerald-500/20 rounded-2xl overflow-hidden backdrop-blur-xl">
          <div className="p-6 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-mono font-bold text-emerald-400 uppercase tracking-wider">
              &gt; Recent Transfer Hook Events
            </h2>
            <span className="text-xs font-mono text-slate-500">{logs.length} events logged</span>
          </div>

          <div className="divide-y divide-slate-800/60">
            {logs.map((log) => (
              <div key={log.id} className="p-6 hover:bg-slate-900/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1 ${
                        log.status === 'APPROVED'
                          ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                          : log.status === 'CLAWBACK'
                          ? 'bg-purple-500/10 border border-purple-500/30 text-purple-400'
                          : 'bg-red-500/10 border border-red-500/30 text-red-400'
                      }`}
                    >
                      {log.status === 'APPROVED' && <HiCheckCircle className="w-3 h-3" />}
                      {log.status !== 'APPROVED' && <HiXCircle className="w-3 h-3" />}
                      {log.status}
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-200">{log.agentName}</span>
                  </div>

                  <p className="text-xs font-mono text-slate-400">
                    <span className="text-slate-500">Action:</span> {log.ruleExecuted}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500">
                    Recipient: <span className="text-slate-300">{log.recipient}</span> • Tx: <span className="text-cyan-400">{log.txHash}</span>
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-sm font-mono font-bold text-slate-200 block">{log.amount}</span>
                  <span className="text-[10px] font-mono text-slate-500 block">{log.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}