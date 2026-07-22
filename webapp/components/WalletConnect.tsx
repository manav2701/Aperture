'use client';

import { useState, useEffect } from 'react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

export function formatAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export default function WalletConnect() {
  const [mounted, setMounted] = useState(false);
  const { publicKey, connected, disconnect, wallet } = useSolanaWallet();
  const { setVisible } = useWalletModal();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-10 w-36 animate-pulse bg-muted/40 rounded-lg" />
    );
  }

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900/80 border border-emerald-500/30 rounded-lg backdrop-blur-md shadow-lg shadow-emerald-950/20">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-ping" />
          <span className="text-xs font-mono font-bold text-emerald-400 tracking-wider">
            SOL
          </span>
          <span className="text-sm font-mono font-medium text-slate-200">
            {formatAddress(publicKey.toBase58(), 4)}
          </span>
        </div>

        <button
          onClick={() => disconnect()}
          className="px-4 py-2 text-xs font-mono font-semibold text-slate-400 hover:text-red-400 hover:bg-slate-800/80 border border-slate-800 hover:border-red-500/30 rounded-lg transition-all uppercase tracking-wider"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-mono font-bold rounded-lg shadow-lg shadow-cyan-500/20 transition-all uppercase tracking-wider flex items-center gap-2 border border-cyan-400/30"
    >
      <span className="text-cyan-200">&gt;</span> Connect Solana Wallet
    </button>
  );
}

export function useWallet() {
  const { publicKey, connected, wallet, disconnect, signTransaction, signAllTransactions } = useSolanaWallet();
  const address = publicKey ? publicKey.toBase58() : '';

  return {
    publicKey,
    address,
    isConnected: connected,
    wallet,
    disconnect,
    signTransaction,
    signAllTransactions,
  };
}