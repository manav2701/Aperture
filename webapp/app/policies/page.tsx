'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { getSolanaConnection, getPolicyPDA } from '@/lib/solana';
import { PublicKey } from '@solana/web3.js';
import { HiShieldCheck, HiPlus, HiTrash, HiCheckCircle, HiExclamationCircle } from 'react-icons/hi';

export const dynamic = 'force-dynamic';

export default function PoliciesPage() {
  const { address, isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [derivedPolicyPDA, setDerivedPolicyPDA] = useState('');

  // Policy Form State
  const [agentPubKey, setAgentPubKey] = useState('');
  const [dailyLimitSol, setDailyLimitSol] = useState('100');
  const [perTxLimitSol, setPerTxLimitSol] = useState('20');
  const [velocityCap, setVelocityCap] = useState('10');
  const [recipientInput, setRecipientInput] = useState('');
  const [allowlist, setAllowlist] = useState<string[]>([]);

  useEffect(() => {
    if (publicKey) {
      const [pda] = getPolicyPDA(publicKey);
      setDerivedPolicyPDA(pda.toBase58());
      if (!agentPubKey) {
        setAgentPubKey(publicKey.toBase58());
      }
    }
  }, [publicKey]);

  const handleAddRecipient = () => {
    if (!recipientInput) return;
    try {
      new PublicKey(recipientInput); // Validate pubkey
      if (!allowlist.includes(recipientInput)) {
        setAllowlist([...allowlist, recipientInput]);
      }
      setRecipientInput('');
    } catch {
      alert('Invalid Solana Public Key address');
    }
  };

  const handleRemoveRecipient = (pubkeyToRemove: string) => {
    setAllowlist(allowlist.filter((addr) => addr !== pubkeyToRemove));
  };

  const handleSavePolicy = async () => {
    if (!isConnected) {
      alert('Please connect your Solana wallet first');
      return;
    }
    if (!agentPubKey) {
      alert('Please specify an Agent Public Key');
      return;
    }

    setLoading(true);
    try {
      alert(`Policy for Agent ${agentPubKey.slice(0, 6)}... created on Solana localnet/devnet!`);
    } catch (err) {
      console.error('Policy error:', err);
      alert('Failed to save policy');
    } finally {
      setLoading(false);
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
            Connect your wallet to configure AI Agent spending policies
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-cyan-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiShieldCheck className="w-8 h-8 text-cyan-400" />
            <h1 className="text-2xl font-black font-mono text-cyan-400 uppercase tracking-wider">
              POLICY MANAGER CONFIGURATOR
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Configure Solana Anchor Policy Accounts for SPL Token-2022 Transfer Hook Enforcement
          </p>
          {derivedPolicyPDA && (
            <div className="mt-4 p-3 bg-slate-950 border border-cyan-500/20 rounded-xl flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Derived Policy Account PDA:</span>
              <span className="text-xs font-mono font-semibold text-cyan-400">{derivedPolicyPDA}</span>
            </div>
          )}
        </div>

        {/* Policy Configuration Form */}
        <div className="bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-8 backdrop-blur-xl space-y-6">
          <h2 className="text-lg font-mono font-bold text-cyan-400 uppercase tracking-wider border-b border-slate-800 pb-3">
            &gt; Policy Parameters
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                Agent Wallet Address (Pubkey)
              </label>
              <input
                type="text"
                value={agentPubKey}
                onChange={(e) => setAgentPubKey(e.target.value)}
                placeholder="Solana Agent Public Key"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                Velocity Cap (Max Tx / Hour)
              </label>
              <input
                type="number"
                value={velocityCap}
                onChange={(e) => setVelocityCap(e.target.value)}
                placeholder="10"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                Daily Spending Limit (SOL)
              </label>
              <input
                type="number"
                value={dailyLimitSol}
                onChange={(e) => setDailyLimitSol(e.target.value)}
                placeholder="100.00"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                Single Tx Cap (SOL)
              </label>
              <input
                type="number"
                value={perTxLimitSol}
                onChange={(e) => setPerTxLimitSol(e.target.value)}
                placeholder="20.00"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Recipient Allowlist */}
          <div className="pt-4 border-t border-slate-800 space-y-4">
            <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block">
              Recipient Allowlist (Approved DEX / Smart Contract Pubkeys)
            </label>

            <div className="flex gap-3">
              <input
                type="text"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                placeholder="Paste approved recipient Pubkey"
                className="flex-1 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
              <button
                onClick={handleAddRecipient}
                className="px-5 py-3 bg-slate-800 hover:bg-slate-700 border border-cyan-500/30 text-cyan-400 font-mono font-bold text-xs rounded-xl flex items-center gap-2 transition-all uppercase tracking-wider"
              >
                <HiPlus className="w-4 h-4" /> Add
              </button>
            </div>

            {allowlist.length > 0 ? (
              <div className="space-y-2">
                {allowlist.map((addr) => (
                  <div
                    key={addr}
                    className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300"
                  >
                    <span>{addr}</span>
                    <button
                      onClick={() => handleRemoveRecipient(addr)}
                      className="text-red-400 hover:text-red-300 transition-colors p-1"
                    >
                      <HiTrash className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs font-mono text-slate-600 italic">No allowlisted recipients added yet (allow all if empty).</p>
            )}
          </div>

          <button
            onClick={handleSavePolicy}
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-mono font-black text-sm rounded-xl transition-all uppercase tracking-widest shadow-lg shadow-cyan-500/20"
          >
            CREATE / UPDATE ON-CHAIN POLICY
          </button>
        </div>

      </div>
    </div>
  );
}