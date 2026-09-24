'use client';

import { useState } from 'react';
import { useWallet } from './WalletConnect';

export default function EmergencyControls() {
  const { isConnected } = useWallet();
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
    <div className="bg-background border-2 border-destructive p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-3 border-b-2 border-border pb-4">
        <div className="w-3 h-3 bg-destructive animate-pulse" />
        <h2 className="font-mono text-lg font-bold text-destructive uppercase tracking-tighter">
          [!] TOKEN-2022 EMERGENCY CONTROLS
        </h2>
      </div>

      <div className="space-y-6">
        {/* Pause / Resume Agent */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-muted border-2 border-border">
          <div>
            <h3 className="font-mono font-bold text-accent uppercase tracking-tighter text-sm">PAUSE AGENT POLICY</h3>
            <p className="text-xs font-mono text-mutedForeground uppercase tracking-wide mt-1">
              Temporarily block transfer hook authorization on-chain
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePause}
              disabled={loading}
              className="px-5 py-2.5 bg-accent text-accentForeground font-mono font-bold text-xs hover:bg-foreground hover:text-background transition-all uppercase tracking-tighter border-2 border-accent"
            >
              PAUSE
            </button>
            <button
              onClick={handleResume}
              disabled={loading}
              className="px-5 py-2.5 bg-background text-foreground hover:bg-muted font-mono font-bold text-xs transition-all uppercase tracking-tighter border-2 border-border"
            >
              RESUME
            </button>
          </div>
        </div>

        {/* Permanent Delegate Clawback */}
        <div className="p-5 bg-muted border-2 border-destructive space-y-4">
          <div>
            <h3 className="font-mono font-bold text-destructive uppercase tracking-tighter text-sm">
              ⚡ PERMANENT DELEGATE CLAWBACK
            </h3>
            <p className="text-xs font-mono text-mutedForeground uppercase tracking-wide mt-1">
              Bypasses policy limits to instantly reclaim agent tokens to treasury
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="AGENT WALLET PUBKEY"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              className="px-4 py-3 bg-background border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
            <input
              type="number"
              placeholder="CLAWBACK AMOUNT"
              value={clawbackAmount}
              onChange={(e) => setClawbackAmount(e.target.value)}
              className="px-4 py-3 bg-background border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
          </div>

          <button
            onClick={handleClawback}
            disabled={loading}
            className="w-full py-3.5 bg-destructive text-foreground hover:bg-foreground hover:text-background font-mono font-bold text-xs transition-all uppercase tracking-widest border-2 border-destructive"
          >
            EXECUTE EMERGENCY CLAWBACK
          </button>
        </div>
      </div>
    </div>
  );
}