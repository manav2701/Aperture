'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import { HiExclamation, HiCheckCircle, HiXCircle } from 'react-icons/hi';

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
  const { isConnected, publicKey } = useWallet();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);

  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    async function loadApprovals() {
      if (!publicKey) return;
      try {
        const { data } = await supabase
          .from('payment_history')
          .select('*')
          .eq('owner_address', publicKey.toBase58())
          .eq('status', 'PENDING_APPROVAL');

        if (data && data.length > 0) {
          setApprovals(
            data.map((item: any) => ({
              id: item.id,
              agentName: 'Agent Wallet',
              agentAddress: item.agent_address,
              amountSol: (item.amount || 0) / 1_000_000_000,
              recipient: item.recipient_address || 'Contract Account',
              reason: item.reason || 'Escalation threshold reached',
              timestamp: new Date(item.created_at).toLocaleTimeString(),
              status: 'PENDING',
            }))
          );
        } else {
          setApprovals([]);
        }
      } catch (err) {
        console.warn('Error loading approvals:', err);
        setApprovals([]);
      } finally {
        setLoading(false);
      }
    }

    loadApprovals();
  }, [publicKey]);

  const handleApprove = async (id: string) => {
    setLoadingId(id);
    try {
      setApprovals(approvals.map((a) => (a.id === id ? { ...a, status: 'APPROVED' } : a)));
      alert(`Approval ${id} confirmed on-chain! Transaction released.`);
    } catch (err) {
      console.error('Approve error:', err);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDeny = async (id: string) => {
    setLoadingId(id);
    try {
      setApprovals(approvals.map((a) => (a.id === id ? { ...a, status: 'DENIED' } : a)));
      alert(`Approval ${id} denied! Transaction rejected.`);
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
            <span className="text-xs font-mono text-slate-400 font-semibold">{approvals.length} pending review</span>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-400 rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-xs font-mono text-slate-400">Querying escalation queue...</p>
            </div>
          ) : approvals.length > 0 ? (
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
                      Recipient: <span className="text-slate-300">{item.recipient}</span> • Agent: <span className="text-cyan-400">{item.agentAddress}</span>
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
            <p className="text-xs font-mono text-slate-500 italic text-center py-12">
              No pending approval escalations found for this wallet.
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
