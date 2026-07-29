'use client';

import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';
import SolanaProvider from './SolanaProvider';
import Link from 'next/link';
import { useState } from 'react';
import { HiChevronDown, HiMenu, HiX } from 'react-icons/hi';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleCategory = (cat: string) => {
    setOpenCategory(openCategory === cat ? null : cat);
  };

  const navCategories = [
    {
      title: 'POLICY & AGENTS',
      items: [
        { label: 'AGENTS FLEET', href: '/agents' },
        { label: 'SPENDING POLICIES', href: '/policies' },
        { label: 'SESSION BUDGETS', href: '/sessions' },
      ],
    },
    {
      title: 'ORGANIZATION',
      items: [
        { label: 'ORG SETTINGS', href: '/org' },
        { label: 'ROLES & RBAC', href: '/roles' },
        { label: 'DELEGATION TREE', href: '/delegation' },
        { label: 'APPROVALS QUEUE', href: '/approvals' },
      ],
    },
    {
      title: 'FINANCE & AUDIT',
      items: [
        { label: 'TREASURY VAULT', href: '/treasury' },
        { label: 'FLEET MONITOR', href: '/company' },
        { label: 'AUDIT LOGS', href: '/audit' },
      ],
    },
  ];

  return (
    <SolanaProvider>
      <div className="kinetic-noise min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-accent selection:text-accentForeground">
        {isLandingPage ? (
          <>{children}</>
        ) : (
          <>
            {/* Kinetic Header */}
            <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b-2 border-border">
              <div className="max-w-[95vw] mx-auto px-4 sm:px-6">
                <div className="flex items-center justify-between h-16">
                  
                  {/* Brand Logo */}
                  <Link href="/" className="flex items-center gap-3 group">
                    <div className="w-9 h-9 bg-accent text-accentForeground font-bold font-mono text-xl flex items-center justify-center border-2 border-accent transition-transform group-hover:scale-105">
                      A
                    </div>
                    <div>
                      <div className="text-base font-bold font-mono text-foreground uppercase tracking-tighter leading-none group-hover:text-accent transition-colors">
                        APERTURE
                      </div>
                      <div className="text-[9px] font-mono text-mutedForeground uppercase tracking-widest leading-none mt-1">
                        SOLANA TREASURY v3
                      </div>
                    </div>
                  </Link>

                  {/* Desktop Categorized Navigation (De-cluttered) */}
                  <nav className="hidden lg:flex items-center gap-1">
                    <Link
                      href="/"
                      className={`px-3 py-2 text-xs font-mono font-bold tracking-tighter transition-all uppercase ${
                        pathname === '/' ? 'text-accent bg-muted border-b-2 border-accent' : 'text-mutedForeground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      HOME
                    </Link>
                    
                    <Link
                      href="/dashboard"
                      className={`px-3 py-2 text-xs font-mono font-bold tracking-tighter transition-all uppercase ${
                        pathname === '/dashboard' ? 'text-accent bg-muted border-b-2 border-accent' : 'text-mutedForeground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      DASHBOARD
                    </Link>

                    {/* De-cluttered Categorized Dropdowns */}
                    {navCategories.map((cat) => (
                      <div key={cat.title} className="relative">
                        <button
                          onClick={() => toggleCategory(cat.title)}
                          onBlur={() => setTimeout(() => setOpenCategory(null), 200)}
                          className={`px-3 py-2 text-xs font-mono font-bold tracking-tighter transition-all uppercase flex items-center gap-1.5 ${
                            openCategory === cat.title || cat.items.some((i) => i.href === pathname)
                              ? 'text-accent bg-muted border-b-2 border-accent'
                              : 'text-mutedForeground hover:text-foreground hover:bg-muted'
                          }`}
                        >
                          {cat.title}
                          <HiChevronDown className={`w-3.5 h-3.5 transition-transform ${openCategory === cat.title ? 'rotate-180 text-accent' : ''}`} />
                        </button>

                        {openCategory === cat.title && (
                          <div className="absolute top-full left-0 mt-1 w-56 bg-background border-2 border-border p-1 shadow-2xl z-50">
                            {cat.items.map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                className={`block px-3 py-2 text-xs font-mono font-bold tracking-tight uppercase transition-all ${
                                  pathname === item.href
                                    ? 'bg-accent text-accentForeground'
                                    : 'text-mutedForeground hover:text-foreground hover:bg-muted'
                                }`}
                              >
                                &gt; {item.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </nav>

                  {/* Wallet & Mobile Toggle */}
                  <div className="flex items-center gap-3">
                    <WalletConnect />

                    <button
                      onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                      className="lg:hidden p-2 text-foreground border-2 border-border hover:bg-muted"
                    >
                      {mobileMenuOpen ? <HiX className="w-6 h-6" /> : <HiMenu className="w-6 h-6" />}
                    </button>
                  </div>

                </div>
              </div>

              {/* Mobile Drawer Navigation */}
              {mobileMenuOpen && (
                <div className="lg:hidden bg-background border-b-2 border-border p-4 space-y-4">
                  <div className="flex flex-col gap-2">
                    <Link
                      href="/"
                      onClick={() => setMobileMenuOpen(false)}
                      className="px-3 py-2 text-sm font-mono font-bold tracking-tighter text-foreground hover:bg-accent hover:text-black uppercase"
                    >
                      HOME
                    </Link>
                    <Link
                      href="/dashboard"
                      onClick={() => setMobileMenuOpen(false)}
                      className="px-3 py-2 text-sm font-mono font-bold tracking-tighter text-foreground hover:bg-accent hover:text-black uppercase"
                    >
                      DASHBOARD
                    </Link>
                    {navCategories.map((cat) => (
                      <div key={cat.title} className="space-y-1 pt-2 border-t border-border">
                        <div className="text-[10px] font-mono text-accent font-bold uppercase tracking-widest px-3">
                          {cat.title}
                        </div>
                        {cat.items.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className="block px-3 py-1.5 text-xs font-mono text-mutedForeground hover:text-foreground uppercase"
                          >
                            &gt; {item.label}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </header>

            {/* Main Content View */}
            <main className="flex-1">
              {children}
            </main>

            {/* Kinetic Footer */}
            <footer className="bg-background border-t-2 border-border py-8">
              <div className="max-w-[95vw] mx-auto px-4 sm:px-6">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="text-xs font-mono text-mutedForeground uppercase tracking-widest">
                    APERTURE v3 • SOLANA ANCHOR SPENDING POLICIES & TREASURY
                  </div>
                  <div className="flex items-center gap-6 text-xs font-mono font-bold tracking-tight">
                    <a
                      href="https://github.com/manav2701/Aperture"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-mutedForeground hover:text-accent transition-colors uppercase"
                    >
                      GITHUB
                    </a>
                    <span className="text-border">|</span>
                    <a
                      href="https://solana.com/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-mutedForeground hover:text-accent transition-colors uppercase"
                    >
                      SOLANA DOCS
                    </a>
                    <span className="text-border">|</span>
                    <a
                      href="https://explorer.solana.com/?cluster=devnet"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-mutedForeground hover:text-accent transition-colors uppercase"
                    >
                      EXPLORER
                    </a>
                  </div>
                </div>
              </div>
            </footer>
          </>
        )}
      </div>
    </SolanaProvider>
  );
}
