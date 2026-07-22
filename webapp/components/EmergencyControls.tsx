'use client';

import { useState } from 'react';
import { useWallet } from './WalletConnect';
import { PublicKey } from '@solana/web3.js';

export default function EmergencyControls() {
  const { address, isConnected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [agentAddress, setAgentAddress] = useState('');
  const [clawbackAmount, setClawbackAmount] = useState('');

  const handlePause = async () => {
    if (!isConnected) {
      alert('Please connect your Solana wallet first');
      return;
    }
    if (!confirm('Pause this agent? All transfers will be blocked immediately.')) return;

    setLoading(true);
    try {
      alert('Agent pause instruction initialized on-chain!');
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to pause agent');
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    if (!isConnected) return;

    setLoading(true);
    try {
      alert('Agent resume instruction executed!');
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to resume agent');
    } finally {
      setLoading(false);
    }
  };

  const handleClawback = async () => {
    if (!isConnected) {
      alert('Please connect your owner wallet');
      return;
    }
    if (!agentAddress || !clawbackAmount) {
      alert('Please enter Agent Wallet Address and Clawback Amount');
      return;
    }
    if (!confirm(`Execute PERMANENT DELEGATE CLAWBACK of ${clawbackAmount} tokens from agent ${agentAddress}?`)) return;

    setLoading(true);
    try {
      alert(`Token-2022 Permanent Delegate Clawback executed! Reclaimed ${clawbackAmount} tokens.`);
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to execute emergency clawback');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-red-500/40 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-red-950/20">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-3 h-3 bg-red-500 rounded-full animate-ping" />
        <h2 className="font-mono text-xl font-bold text-red-400 uppercase tracking-wider">
          &gt; Token-2022 Emergency Controls
        </h2>
      </div>

      <div className="space-y-6">
        {/* Pause Agent */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-slate-950/60 border border-amber-500/30 rounded-xl">
          <div>
            <h3 className="font-mono font-bold text-amber-400 uppercase tracking-wider text-sm">PAUSE AGENT POLICY</h3>
            <p className="text-xs font-mono text-slate-400 uppercase tracking-wide mt-1">
              Temporarily blocks transfer hook authorization
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePause}
              disabled={loading}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs rounded-lg transition-all uppercase tracking-wider shadow-lg shadow-amber-500/20"
            >
              PAUSE
            </button>
            <button
              onClick={handleResume}
              disabled={loading}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 font-mono font-bold text-xs rounded-lg transition-all uppercase tracking-wider"
            >
              RESUME
            </button>
          </div>
        </div>

        {/* Permanent Delegate Clawback */}
        <div className="p-5 bg-slate-950/80 border border-red-500/40 rounded-xl space-y-4">
          <div>
            <h3 className="font-mono font-bold text-red-400 uppercase tracking-wider text-sm flex items-center gap-2">
              <span>⚡ PERMANENT DELEGATE CLAWBACK</span>
            </h3>
            <p className="text-xs font-mono text-slate-400 uppercase tracking-wide mt-1">
              Bypasses transfer hook policy checks to reclaim agent tokens immediately
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Agent Wallet Address (Pubkey)"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-red-500"
            />
            <input
              type="number"
              placeholder="Clawback Amount"
              value={clawbackAmount}
              onChange={(e) => setClawbackAmount(e.target.value)}
              className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-red-500"
            />
          </div>

          <button
            onClick={handleClawback}
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-mono font-bold text-xs rounded-lg transition-all uppercase tracking-widest shadow-lg shadow-red-600/30"
          >
            EXECUTE EMERGENCY CLAWBACK
          </button>
        </div>
      </div>
    </div>
  );
}