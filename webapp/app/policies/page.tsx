'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { getSolanaConnection, getPolicyPDA, fetchPolicyAccountOnChain } from '@/lib/solana';
import { PublicKey } from '@solana/web3.js';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default function PoliciesPage() {
  const { isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [derivedPolicyPDA, setDerivedPolicyPDA] = useState('');
  const [isExistingPolicy, setIsExistingPolicy] = useState(false);

  // Policy Form State
  const [agentPubKey, setAgentPubKey] = useState('');
  const [dailyLimitSol, setDailyLimitSol] = useState('100');
  const [perTxLimitSol, setPerTxLimitSol] = useState('20');
  const [velocityCap, setVelocityCap] = useState('10');
  const [recipientInput, setRecipientInput] = useState('');
  const [allowlist, setAllowlist] = useState<string[]>([]);

  useEffect(() => {
    if (!publicKey) return;

    async function checkExistingPolicy() {
      if (!publicKey) return;
      const connection = getSolanaConnection();
      const [pda] = getPolicyPDA(publicKey);
      setDerivedPolicyPDA(pda.toBase58());
      setAgentPubKey(publicKey.toBase58());

      const policyOnChain = await fetchPolicyAccountOnChain(connection, pda);
      if (policyOnChain) {
        setIsExistingPolicy(true);
        setDailyLimitSol((policyOnChain.dailyLimit.toNumber() / 1_000_000_000).toString());
        setPerTxLimitSol((policyOnChain.perTxLimit.toNumber() / 1_000_000_000).toString());
        setVelocityCap(policyOnChain.velocityMaxTxPerHour.toString());
        setAllowlist(policyOnChain.allowlist.map((pk) => pk.toBase58()));
      } else {
        setIsExistingPolicy(false);
      }
    }

    checkExistingPolicy();
  }, [publicKey]);

  const handleAddRecipient = () => {
    if (!recipientInput) return;
    try {
      new PublicKey(recipientInput);
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
    if (!isConnected || !publicKey) {
      alert('Please connect your Solana wallet first');
      return;
    }
    if (!agentPubKey) {
      alert('Please specify an Agent Public Key');
      return;
    }

    setLoading(true);
    try {
      // Convert SOL to base units (lamports/stx) for DB storage
      const dailyLamports = parseFloat(dailyLimitSol) * 1_000_000_000;
      const perTxLamports = parseFloat(perTxLimitSol) * 1_000_000_000;

      const { error } = await supabase.from('policies').upsert({
        agent_address: agentPubKey,
        owner_address: publicKey.toBase58(),
        daily_limit_stx: dailyLamports,
        per_tx_limit_stx: perTxLamports,
        daily_limit_sbtc: 0,
        per_tx_limit_sbtc: 0,
        is_active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'agent_address' });

      if (error) throw error;
      
      setIsExistingPolicy(true);
      alert(`Policy Account for ${agentPubKey.slice(0, 6)}... saved to database successfully!`);
    } catch (err: any) {
      console.error('Policy error:', err);
      alert('Failed to save policy: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full border-2 border-border p-10 text-center space-y-6 bg-background">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <h2 className="text-xl font-bold font-mono text-foreground uppercase tracking-tighter">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-xs font-mono text-mutedForeground uppercase tracking-tight">
            Connect your wallet to configure AI Agent spending policies
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[GUARDRAILS]</span>
            <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
              POLICY CONFIGURATOR
            </h1>
            <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
              SOLANA ANCHOR POLICY ACCOUNTS FOR SPL TOKEN-2022 TRANSFER HOOK ENFORCEMENT
            </p>
          </div>
          {isExistingPolicy && (
            <span className="px-4 py-2 bg-accent text-accentForeground font-mono text-xs font-bold uppercase tracking-widest border-2 border-accent self-start sm:self-auto">
              [✓] ON-CHAIN POLICY ACTIVE
            </span>
          )}
        </div>

        {derivedPolicyPDA && (
          <div className="mt-6 p-4 bg-muted border-2 border-border flex items-center justify-between flex-wrap gap-2">
            <span className="text-[10px] font-mono text-mutedForeground uppercase tracking-widest">DERIVED POLICY PDA:</span>
            <span className="text-xs font-mono font-bold text-accent">{derivedPolicyPDA}</span>
          </div>
        )}
      </div>

      {/* Policy Form */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <h2 className="text-xl font-mono font-bold text-accent uppercase tracking-tighter border-b-2 border-border pb-3">
          &gt; POLICY PARAMETERS
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
              AGENT WALLET PUBKEY
            </label>
            <input
              type="text"
              value={agentPubKey}
              onChange={(e) => setAgentPubKey(e.target.value)}
              placeholder="SOLANA AGENT PUBLIC KEY"
              className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
          </div>

          <div>
            <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
              VELOCITY CAP (MAX TX / HOUR)
            </label>
            <input
              type="number"
              value={velocityCap}
              onChange={(e) => setVelocityCap(e.target.value)}
              placeholder="10"
              className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
          </div>

          <div>
            <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
              DAILY SPENDING LIMIT (SOL)
            </label>
            <input
              type="number"
              value={dailyLimitSol}
              onChange={(e) => setDailyLimitSol(e.target.value)}
              placeholder="100.00"
              className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
          </div>

          <div>
            <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
              SINGLE TX CAP (SOL)
            </label>
            <input
              type="number"
              value={perTxLimitSol}
              onChange={(e) => setPerTxLimitSol(e.target.value)}
              placeholder="20.00"
              className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
          </div>
        </div>

        {/* Recipient Allowlist */}
        <div className="pt-6 border-t-2 border-border space-y-4">
          <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">
            RECIPIENT ALLOWLIST (APPROVED CONTRACT / DEX PUBKEYS)
          </label>

          <div className="flex gap-3">
            <input
              type="text"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              placeholder="PASTE APPROVED RECIPIENT PUBKEY"
              className="flex-1 px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
            <button
              onClick={handleAddRecipient}
              className="kinetic-btn-outline px-6 py-3 text-xs tracking-tighter"
            >
              [+] ADD
            </button>
          </div>

          {allowlist.length > 0 ? (
            <div className="space-y-2">
              {allowlist.map((addr) => (
                <div
                  key={addr}
                  className="flex items-center justify-between p-3 bg-muted border border-border text-xs font-mono text-foreground"
                >
                  <span className="font-bold">{addr}</span>
                  <button
                    onClick={() => handleRemoveRecipient(addr)}
                    className="text-destructive font-bold uppercase hover:underline"
                  >
                    [REMOVE]
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-mono text-mutedForeground uppercase italic">No allowlisted recipients added (allows all if empty).</p>
          )}
        </div>

        <button
          onClick={handleSavePolicy}
          disabled={loading}
          className="kinetic-btn-primary w-full py-4 text-sm tracking-tighter"
        >
          {isExistingPolicy ? 'UPDATE ON-CHAIN POLICY' : 'CREATE ON-CHAIN POLICY'}
        </button>
      </div>

    </div>
  );
}