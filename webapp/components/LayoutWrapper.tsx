'use client';

import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';
import Link from 'next/link';
import { useState } from 'react';
import { HiChevronDown, HiServer, HiShieldCheck, HiClock, HiDocumentText, HiOfficeBuilding } from 'react-icons/hi';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (isLandingPage) {
    // Render only children on landing page (no header/footer)
    return <>{children}</>;
  }

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-xl border-b-2 border-accent shadow-neon-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-accent cyber-chamfer-sm flex items-center justify-center shadow-neon group-hover:brightness-110 transition-all">
                <span className="text-background font-bold text-xl font-mono">A</span>
              </div>
              <div className="hidden sm:block">
                <div className="text-lg font-bold font-mono text-accent uppercase tracking-wider">APERTURE</div>
              </div>
            </Link>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-2">
              <Link
                href="/"
                className="px-4 py-2 text-sm font-mono font-medium text-foreground hover:bg-white hover:text-black cyber-chamfer-sm transition-all uppercase tracking-wider"
              >
                HOME
              </Link>
              
              <Link
                href="/dashboard"
                className="px-4 py-2 text-sm font-mono font-medium text-foreground hover:bg-white hover:text-black cyber-chamfer-sm transition-all uppercase tracking-wider"
              >
                DASHBOARD
              </Link>
              
              {/* Operations Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
                  className="px-4 py-2 text-sm font-mono font-medium text-foreground hover:bg-white hover:text-black cyber-chamfer-sm transition-all uppercase tracking-wider flex items-center gap-2"
                >
                  OPERATIONS
                  <HiChevronDown className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {dropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-48 bg-black border-2 border-accent cyber-chamfer shadow-neon py-2 z-50">
                    <Link
                      href="/company"
                      className="flex items-center gap-3 px-4 py-2 text-sm font-mono font-medium text-foreground hover:bg-white hover:text-black transition-all uppercase tracking-wider"
                    >
                      <HiOfficeBuilding className="w-4 h-4" />
                      COMPANY
                    </Link>
                    <Link
                      href="/agents"
                      className="flex items-center gap-3 px-4 py-2 text-sm font-mono font-medium text-foreground hover:bg-white hover:text-black transition-all uppercase tracking-wider"
                    >
                      <HiServer className="w-4 h-4" />
                      AGENTS
                    </Link>
                    <Link
                      href="/policies"
                      className="flex items-center gap-3 px-4 py-2 text-sm font-mono font-medium text-foreground hover:bg-white hover:text-black transition-all uppercase tracking-wider"
                    >
                      <HiShieldCheck className="w-4 h-4" />
                      POLICIES
                    </Link>
                    <Link
                      href="/sessions"
                      className="flex items-center gap-3 px-4 py-2 text-sm font-mono font-medium text-foreground hover:bg-white hover:text-black transition-all uppercase tracking-wider"
                    >
                      <HiClock className="w-4 h-4" />
                      SESSIONS
                    </Link>
                    <Link
                      href="/audit"
                      className="flex items-center gap-3 px-4 py-2 text-sm font-mono font-medium text-foreground hover:bg-white hover:text-black transition-all uppercase tracking-wider"
                    >
                      <HiDocumentText className="w-4 h-4" />
                      AUDIT LOG
                    </Link>
                  </div>
                )}
              </div>
            </nav>

            {/* Wallet Connect */}
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="min-h-[calc(100vh-4rem)]">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-card border-t-2 border-accent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-sm font-mono text-mutedForeground uppercase tracking-wider">
              BUILT ON STACKS • POWERED BY X402-STACKS V2
            </div>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/yourusername/x402-policy-manager"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-mono text-foreground hover:text-accent transition-colors uppercase tracking-wider"
              >
                GITHUB
              </a>
              <span className="text-border">|</span>
              <a
                href="https://docs.stacksx402.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-mono text-foreground hover:text-accent transition-colors uppercase tracking-wider"
              >
                DOCS
              </a>
              <span className="text-border">|</span>
              <a
                href="https://explorer.hiro.so/?chain=testnet"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-mono text-foreground hover:text-accent transition-colors uppercase tracking-wider"
              >
                EXPLORER
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
