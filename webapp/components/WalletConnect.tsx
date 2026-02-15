// webapp/components/WalletConnect.tsx
'use client';

import { useState, useEffect } from 'react';
import { AppConfig, UserSession } from '@stacks/connect';
import { formatAddress } from '@/lib/stacks';

const appConfig = new AppConfig(['store_write', 'publish_data']);
export const userSession = new UserSession({ appConfig });

interface UserData {
  profile: {
    stxAddress: {
      testnet: string;
      mainnet: string;
    };
  };
}

export default function WalletConnect() {
  const [mounted, setMounted] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      setMounted(true);
      
      // Check if user is already signed in
      if (userSession.isUserSignedIn()) {
        const data = userSession.loadUserData();
        setUserData(data as UserData);
      } else if (userSession.isSignInPending()) {
        // Handle pending sign in
        try {
          const data = await userSession.handlePendingSignIn();
          setUserData(data as UserData);
          window.history.replaceState({}, document.title, "/");
        } catch (error) {
          console.error('Error handling pending sign in:', error);
        }
      }
    };
    
    checkAuth();
  }, []);

  const connectWallet = async () => {
    try {
      // Try to use the authenticate function from @stacks/connect
      const { authenticate } = await import('@stacks/connect');
      
      authenticate({
        appDetails: {
          name: 'Aperture',
          icon: window.location.origin + '/logo.png',
        },
        redirectTo: '/',
        onFinish: () => {
          window.location.reload();
        },
        userSession: userSession,
      });
    } catch (error) {
      console.error('Error with authenticate:', error);
      
      // Fallback: Check for Leather wallet extension provider
      if (typeof window !== 'undefined') {
        interface WindowWithLeather extends Window {
          LeatherProvider?: {
            request: (method: string, params?: unknown) => Promise<unknown>;
          };
        }
        
        const windowWithLeather = window as unknown as WindowWithLeather;
        
        if (windowWithLeather.LeatherProvider) {
          try {
            // Try Leather's RPC method
            const response = await windowWithLeather.LeatherProvider.request('stx_requestAccounts');
            console.log('Wallet connected via Leather:', response);
            setTimeout(() => window.location.reload(), 500);
          } catch (err) {
            console.error('Leather connection failed:', err);
            alert('Failed to connect wallet. Please make sure Leather is unlocked.');
          }
        } else {
          // No wallet detected
          const shouldInstall = confirm(
            'Leather wallet not detected!\n\n' +
            'Install Leather wallet extension:\n' +
            '1. Visit leather.io\n' +
            '2. Install for your browser\n' +
            '3. Set to Testnet mode\n' +
            '4. Return and click Connect Wallet\n\n' +
            'Open leather.io now?'
          );
          
          if (shouldInstall) {
            window.open('https://leather.io', '_blank');
          }
        }
      }
    }
  };

  const disconnectWallet = () => {
    userSession.signUserOut();
    setUserData(null);
    window.location.reload();
  };

  if (!mounted) {
    return (
      <div className="h-10 w-32 animate-pulse bg-muted cyber-chamfer-sm" />
    );
  }

  if (userData) {
    const address = userData.profile.stxAddress.testnet || userData.profile.stxAddress.mainnet;
    
    return (
      <div className="flex items-center gap-3">
        {/* Address display */}
        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-muted border-2 border-border cyber-chamfer-sm">
          <div className="w-2 h-2 bg-accent rounded-full animate-pulse shadow-neon-sm" />
          <span className="text-sm font-mono font-medium text-foreground">
            {formatAddress(address, 6)}
          </span>
        </div>

        {/* Disconnect button */}
        <button
          onClick={disconnectWallet}
          className="px-4 py-2 text-sm font-mono font-medium text-foreground hover:text-destructive hover:bg-muted cyber-chamfer-sm transition-all uppercase tracking-wider"
        >
          DISCONNECT
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connectWallet}
      className="px-6 py-2.5 bg-accent border-2 border-accent text-white font-mono font-bold cyber-chamfer-sm hover:brightness-110 transition-all shadow-neon uppercase tracking-wider"
    >
      {'> '}CONNECT WALLET
    </button>
  );
}

// Hook to use wallet connection in other components
export function useWallet() {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [address, setAddress] = useState<string>('');

  useEffect(() => {
    const loadUserData = () => {
      if (userSession.isUserSignedIn()) {
        const data = userSession.loadUserData();
        setUserData(data as UserData);
        setAddress(data.profile.stxAddress.testnet || data.profile.stxAddress.mainnet);
      }
    };
    
    loadUserData();
  }, []);

  return {
    userData,
    address,
    isConnected: !!userData,
    userSession,
  };
}