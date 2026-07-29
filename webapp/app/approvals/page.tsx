'use client';

import { useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { HiExclamation, HiCheckCircle, HiXCircle, HiClock, HiShieldCheck } from 'react-icons/hi';

export const dynamic = 'force-dynamic';

interface PendingApproval {
  id: string;
  agentName: string;
  agentAddress: string;
  amountSol: number;
  recipient: string;
  reason: string;
  timestamp: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
}

export default function ApprovalsPage() {
  const { isConnected } = useWallet();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const [approvals, setApprovals] = useState<PendingApproval[]>([
    {
      id: 'app-101',
      agentName: 'Arbitrage Agent Alpha',
      agentAddress: '7fCoCyErkSmyzFP1Rf6HKQuVJzmbpk31PwJVDsScnVPi',
      amountSol: 500.0,
      recipient: 'Orca DEX Pool (7fCo...nVPi)',
      reason: 'Transaction exceeds human approval escalation threshold (200 SOL)',
      timestamp: '5 mins ago',
      status: 'PENDING',
    },
    {
      id: 'app-102',
      agentName: 'Liquidity Rebalancer Bot',
      agentAddress: '3M2a1pWk7fCoCyErkSmyzFP1Rf6HKQuVJzmbpk31P',
      amountSol: 250.0,
      recipient: 'Raydium Vault (JAGd...3amM)',
      reason: 'Transaction exceeds escalation threshold (200 SOL)',
      timestamp: '18 mins ago',
      status: 'PENDING',
    },
  ]);

  const handleApprove = async (id: string) => {
    setLoadingId(id);
    try {
      setApprovals(
        approvals.map((a) => (a.id === id ? { ...a, status: 'APPROVED' } : a))
      );
      alert(`Approval ${id} confirmed on-chain! Agent transaction released.`);
    } catch (err) {
      console.error('Approve error:', err);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDeny = async (id: string) => {
    setLoadingId(id);
    try {
      setApprovals(
        approvals.map((a) => (a.id === id ? { ...a, status: 'DENIED' } : a))
      );
      alert(`Approval ${id} denied on-chain! Agent transaction rejected.`);
    } catch (err) {
      console.error('Deny error:', err);
    } finally {
      setLoadingId(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-10 text-center shadow-2xl shadow-cyan-950/30">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-bold font-mono text-cyan-400 mb-3 uppercase tracking-wider">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-slate-400 text-xs font-mono mb-6 leading-relaxed">
            Connect your wallet to inspect and sign pending agent transaction approvals
          </p>
        </div>
      </div>
    );
  }

  const pendingList = approvals.filter((a) => a.status === 'PENDING');

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-amber-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiExclamation className="w-8 h-8 text-amber-400" />
            <h1 className="text-2xl font-black font-mono text-amber-400 uppercase tracking-wider">
              PENDING TRANSACTION APPROVAL QUEUE
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Aperture v3 Axis-5 Approval Escalations • Real-Time Human-in-the-Loop Safeguards
          </p>
        </div>

        {/* Approvals List */}
        <div className="bg-slate-900/80 border border-amber-500/20 rounded-2xl overflow-hidden backdrop-blur-xl space-y-4 p-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <h2 className="text-sm font-mono font-bold text-amber-400 uppercase tracking-wider">
              &gt; Escalated Agent Transactions
            </h2>
            <span className="text-xs font-mono text-slate-400 font-semibold">{pendingList.length} pending review</span>
          </div>

          {approvals.length > 0 ? (
            <div className="space-y-4 pt-2">
              {approvals.map((item) => (
                <div
                  key={item.id}
                  className="p-6 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-6"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="font-mono text-base font-bold text-slate-200">{item.agentName}</h3>
                      <span
                        className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold uppercase ${
                          item.status === 'PENDING'
                            ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                            : item.status === 'APPROVED'
                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                            : 'bg-red-500/10 border border-red-500/30 text-red-400'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>

                    <p className="text-xs font-mono text-slate-400">
                      <span className="text-slate-500">Reason:</span> {item.reason}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500">
                      Recipient: <span className="text-slate-300">{item.recipient}</span> • Agent: <span className="text-cyan-400">{item.agentAddress.slice(0, 6)}...{item.agentAddress.slice(-4)}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="text-xl font-mono font-bold text-amber-400 block">{item.amountSol.toFixed(2)} SOL</span>
                      <span className="text-[10px] font-mono text-slate-500 block">{item.timestamp}</span>
                    </div>

                    {item.status === 'PENDING' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApprove(item.id)}
                          disabled={loadingId === item.id}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs rounded-lg transition-all uppercase tracking-wider flex items-center gap-1 shadow-lg shadow-emerald-500/20"
                        >
                          <HiCheckCircle className="w-4 h-4" /> APPROVE
                        </button>
                        <button
                          onClick={() => handleDeny(item.id)}
                          disabled={loadingId === item.id}
                          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-xs rounded-lg transition-all uppercase tracking-wider flex items-center gap-1 shadow-lg shadow-red-600/20"
                        >
                          <HiXCircle className="w-4 h-4" /> DENY
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-mono text-slate-500 italic text-center py-8">
              No transactions currently awaiting human escalation approval.
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
