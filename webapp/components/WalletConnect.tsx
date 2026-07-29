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
  const { publicKey, connected, disconnect } = useSolanaWallet();
  const { setVisible } = useWalletModal();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-11 w-40 animate-pulse bg-muted border border-border" />
    );
  }

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted border-2 border-border">
          <div className="w-2.5 h-2.5 bg-accent animate-pulse" />
          <span className="text-xs font-mono font-bold text-accent tracking-tighter uppercase">
            SOL
          </span>
          <span className="text-xs font-mono font-bold text-foreground tracking-tight">
            {formatAddress(publicKey.toBase58(), 4)}
          </span>
        </div>

        <button
          onClick={() => disconnect()}
          className="px-3 py-2 text-xs font-mono font-bold text-mutedForeground hover:text-foreground hover:bg-muted border-2 border-border transition-all uppercase tracking-wider"
        >
          DISCONNECT
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      className="kinetic-btn-primary px-5 py-2.5 text-xs font-mono tracking-tighter flex items-center gap-2"
    >
      <span>[+]</span> CONNECT WALLET
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