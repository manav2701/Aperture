'use client';

import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';
import SolanaProvider from './SolanaProvider';
import Link from 'next/link';
import { useState } from 'react';
import { HiChevronDown, HiServer, HiShieldCheck, HiClock, HiDocumentText, HiOfficeBuilding } from 'react-icons/hi';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <SolanaProvider>
      {isLandingPage ? (
        <>{children}</>
      ) : (
        <>
          {/* Header */}
          <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-xl border-b border-cyan-500/30 shadow-lg shadow-cyan-950/30">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                
                {/* Logo */}
                <Link href="/" className="flex items-center gap-3 group">
                  <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20 group-hover:scale-105 transition-all">
                    <span className="text-slate-950 font-black text-xl font-mono">A</span>
                  </div>
                  <div className="hidden sm:block">
                    <div className="text-lg font-bold font-mono text-cyan-400 uppercase tracking-wider">APERTURE</div>
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Solana Token-2022</div>
                  </div>
                </Link>

                {/* Navigation */}
                <nav className="hidden md:flex items-center gap-2">
                  <Link
                    href="/"
                    className="px-4 py-2 text-xs font-mono font-bold text-slate-300 hover:text-cyan-400 hover:bg-slate-900/60 rounded-lg transition-all uppercase tracking-wider"
                  >
                    HOME
                  </Link>
                  
                  <Link
                    href="/dashboard"
                    className="px-4 py-2 text-xs font-mono font-bold text-slate-300 hover:text-cyan-400 hover:bg-slate-900/60 rounded-lg transition-all uppercase tracking-wider"
                  >
                    DASHBOARD
                  </Link>
                  
                  {/* Operations Dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setDropdownOpen(!dropdownOpen)}
                      onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
                      className="px-4 py-2 text-xs font-mono font-bold text-slate-300 hover:text-cyan-400 hover:bg-slate-900/60 rounded-lg transition-all uppercase tracking-wider flex items-center gap-2"
                    >
                      OPERATIONS
                      <HiChevronDown className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {dropdownOpen && (
                      <div className="absolute top-full left-0 mt-2 w-52 bg-slate-900/95 border border-cyan-500/30 rounded-xl shadow-2xl backdrop-blur-xl py-2 z-50">
                        <Link
                          href="/company"
                          className="flex items-center gap-3 px-4 py-2.5 text-xs font-mono font-semibold text-slate-300 hover:text-cyan-400 hover:bg-slate-800/60 transition-all uppercase tracking-wider"
                        >
                          <HiOfficeBuilding className="w-4 h-4 text-cyan-400" />
                          COMPANY
                        </Link>
                        <Link
                          href="/agents"
                          className="flex items-center gap-3 px-4 py-2.5 text-xs font-mono font-semibold text-slate-300 hover:text-cyan-400 hover:bg-slate-800/60 transition-all uppercase tracking-wider"
                        >
                          <HiServer className="w-4 h-4 text-cyan-400" />
                          AGENTS
                        </Link>
                        <Link
                          href="/policies"
                          className="flex items-center gap-3 px-4 py-2.5 text-xs font-mono font-semibold text-slate-300 hover:text-cyan-400 hover:bg-slate-800/60 transition-all uppercase tracking-wider"
                        >
                          <HiShieldCheck className="w-4 h-4 text-cyan-400" />
                          POLICIES
                        </Link>
                        <Link
                          href="/sessions"
                          className="flex items-center gap-3 px-4 py-2.5 text-xs font-mono font-semibold text-slate-300 hover:text-cyan-400 hover:bg-slate-800/60 transition-all uppercase tracking-wider"
                        >
                          <HiClock className="w-4 h-4 text-cyan-400" />
                          SESSIONS
                        </Link>
                        <Link
                          href="/audit"
                          className="flex items-center gap-3 px-4 py-2.5 text-xs font-mono font-semibold text-slate-300 hover:text-cyan-400 hover:bg-slate-800/60 transition-all uppercase tracking-wider"
                        >
                          <HiDocumentText className="w-4 h-4 text-cyan-400" />
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
          <footer className="bg-slate-950 border-t border-cyan-500/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                  BUILT ON SOLANA ANCHOR • POWERED BY SPL TOKEN-2022 TRANSFER HOOKS
                </div>
                <div className="flex items-center gap-4">
                  <a
                    href="https://github.com/manav2701/Aperture"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-slate-300 hover:text-cyan-400 transition-colors uppercase tracking-wider"
                  >
                    GITHUB
                  </a>
                  <span className="text-slate-800">|</span>
                  <a
                    href="https://solana.com/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-slate-300 hover:text-cyan-400 transition-colors uppercase tracking-wider"
                  >
                    SOLANA DOCS
                  </a>
                  <span className="text-slate-800">|</span>
                  <a
                    href="https://explorer.solana.com/?cluster=custom"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-slate-300 hover:text-cyan-400 transition-colors uppercase tracking-wider"
                  >
                    EXPLORER
                  </a>
                </div>
              </div>
            </div>
          </footer>
        </>
      )}
    </SolanaProvider>
  );
}
