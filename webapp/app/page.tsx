'use client';

import Link from 'next/link';
import Marquee from 'react-fast-marquee';

export default function Home() {
  const marqueeStats = [
    { label: 'SOLANA DEVNET', val: 'SPL TOKEN-2022' },
    { label: 'POLICY ENFORCEMENT', val: 'ON-CHAIN HOOKS' },
    { label: 'MAX DAILY CAP', val: '100.00 SOL' },
    { label: 'RESPONSE LATENCY', val: '<400MS' },
    { label: 'AUTONOMOUS AGENTS', val: 'CLAUDE • N8N • OPENCLAW' },
  ];

  const features = [
    {
      num: '01',
      title: 'TOKEN-2022 TRANSFER HOOKS',
      tag: 'ON-CHAIN SECURITY',
      desc: 'Every SPL token transfer executed by an AI agent is validated on-chain by Solana Anchor smart contract hooks before finality.',
    },
    {
      num: '02',
      title: '6-AXIS GUARDRAILS',
      tag: 'POLICY ENGINE',
      desc: 'Enforce daily SOL spending limits, single transaction caps, token allowlists, time-locked windows, and velocity throttles.',
    },
    {
      num: '03',
      title: 'PERMANENT DELEGATE CLAWBACK',
      tag: 'EMERGENCY SHIELD',
      desc: 'Corporate treasurers retain master clawback authority over delegated agent wallets, allowing instant token recovery without consent.',
    },
    {
      num: '04',
      title: 'MULTI-RUNTIME ADAPTERS',
      tag: 'AGENT INTEGRATION',
      desc: 'Plug-and-play SDK adapters for Claude Code, OpenClaw, Hermes, and n8n workflows with standard x402 HTTP interceptors.',
    },
  ];

  return (
    <div className="bg-background text-foreground flex flex-col min-h-screen font-sans selection:bg-accent selection:text-accentForeground overflow-x-hidden">
      
      {/* Top Kinetic Bar */}
      <div className="border-b-2 border-border py-2 bg-accent text-accentForeground overflow-hidden">
        <Marquee speed={80} gradient={false}>
          <div className="flex items-center gap-12 font-mono font-bold text-xs uppercase tracking-tighter pr-12">
            <span>⚡ APERTURE v3 IS LIVE ON SOLANA DEVNET</span>
            <span>★ CORPORATE TREASURY FOR AI AGENTS</span>
            <span>⚡ SPL TOKEN-2022 TRANSFER HOOK ENFORCEMENT</span>
            <span>★ ZERO TRUST AGENT BUDGETING</span>
          </div>
        </Marquee>
      </div>

      {/* Main Nav Header */}
      <header className="border-b-2 border-border py-6 px-4 sm:px-8 max-w-[95vw] mx-auto w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent text-accentForeground font-mono font-bold text-2xl flex items-center justify-center border-2 border-accent">
            A
          </div>
          <span className="text-xl font-black font-mono tracking-tighter uppercase">APERTURE</span>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="kinetic-btn-outline px-5 py-2.5 text-xs font-mono tracking-tighter"
          >
            ENTER DASHBOARD
          </Link>
          <Link
            href="/agents"
            className="kinetic-btn-primary px-6 py-2.5 text-xs font-mono tracking-tighter"
          >
            LAUNCH AGENT
          </Link>
        </div>
      </header>

      {/* Hero Section — Viewport Fluid Kinetic Typography */}
      <section className="py-20 sm:py-32 px-4 sm:px-8 max-w-[95vw] mx-auto w-full">
        <div className="space-y-6">
          <div className="inline-block px-3 py-1 bg-muted border-2 border-border text-accent font-mono text-xs font-bold uppercase tracking-widest">
            [⚡] SOLANA TOKEN-2022 TREASURY GUARDRAILS
          </div>

          <h1 className="text-[clamp(3.2rem,10vw,12rem)] font-black tracking-tighter leading-[0.85] uppercase text-foreground">
            CONTROL <span className="text-accent underline decoration-accent decoration-4">AI AGENT</span> SPENDING
          </h1>

          <p className="text-xl sm:text-2xl lg:text-3xl font-mono text-mutedForeground max-w-4xl leading-tight uppercase tracking-tight pt-4">
            SET IMMUTABLE ON-CHAIN SPENDING LIMITS, PER-TRANSACTION CAPS, AND DELEGATED SESSION BUDGETS FOR AUTONOMOUS SOLANA AGENTS.
          </p>

          <div className="pt-8 flex flex-wrap gap-4">
            <Link
              href="/dashboard"
              className="kinetic-btn-primary px-8 py-5 text-sm sm:text-base font-mono tracking-tighter"
            >
              [&gt;] ACCESS DASHBOARD
            </Link>
            <Link
              href="/policies"
              className="kinetic-btn-outline px-8 py-5 text-sm sm:text-base font-mono tracking-tighter"
            >
              CREATE SPENDING POLICY
            </Link>
          </div>
        </div>
      </section>

      {/* Kinetic Infinite Marquee Banner */}
      <div className="border-y-2 border-border bg-background py-8 my-12">
        <Marquee speed={60} gradient={false}>
          <div className="flex items-center gap-16 font-mono font-bold text-4xl sm:text-6xl text-mutedForeground/40 uppercase tracking-tighter pr-16 select-none">
            {marqueeStats.map((stat, i) => (
              <div key={i} className="flex items-center gap-6">
                <span className="text-accent">{stat.val}</span>
                <span>/</span>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </Marquee>
      </div>

      {/* Kinetic Cards Section — Hard Color Inversions & Massive Graphic Numbers */}
      <section className="py-20 px-4 sm:px-8 max-w-[95vw] mx-auto w-full space-y-12">
        <div className="border-b-2 border-border pb-6 flex items-end justify-between">
          <div>
            <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[FEATURES]</span>
            <h2 className="text-4xl sm:text-6xl font-black tracking-tighter uppercase mt-2">
              KINETIC GUARDRAIL ARCHITECTURE
            </h2>
          </div>
          <span className="font-mono text-mutedForeground text-sm uppercase hidden sm:block">04 CORE MODULES</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {features.map((item) => (
            <div key={item.num} className="kinetic-card p-8 sm:p-12 relative overflow-hidden group">
              <span className="absolute -right-4 -bottom-10 text-[10rem] font-mono font-black text-muted/30 select-none group-hover:text-black/10 transition-colors">
                {item.num}
              </span>
              <div className="relative z-10 space-y-4">
                <span className="kinetic-badge px-3 py-1 bg-muted border border-border text-accent font-mono text-xs font-bold uppercase tracking-widest inline-block">
                  {item.tag}
                </span>
                <h3 className="text-2xl sm:text-4xl font-bold tracking-tighter uppercase leading-none">
                  {item.title}
                </h3>
                <p className="text-base sm:text-lg font-mono text-mutedForeground leading-relaxed uppercase">
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Kinetic High-Impact Call-to-Action */}
      <section className="py-24 px-4 sm:px-8 max-w-[95vw] mx-auto w-full">
        <div className="border-2 border-accent bg-accent text-accentForeground p-8 sm:p-16 space-y-6">
          <span className="font-mono text-xs font-bold uppercase tracking-widest bg-black text-accent px-3 py-1">
            DEPLOYMENT READY
          </span>
          <h2 className="text-4xl sm:text-7xl font-black tracking-tighter uppercase leading-none">
            START PROTECTING YOUR AGENT TREASURY TODAY
          </h2>
          <p className="font-mono text-lg sm:text-xl font-bold uppercase max-w-3xl">
            CONNECT YOUR SOLANA WALLET AND ENFORCE ON-CHAIN TOKEN-2022 TRANSFER HOOK POLICIES IN SECONDS.
          </p>
          <div className="pt-4">
            <Link
              href="/dashboard"
              className="inline-block px-10 py-5 bg-black text-accent hover:bg-white hover:text-black font-mono font-bold text-base uppercase tracking-tighter transition-all border-2 border-black"
            >
              [&gt;] LAUNCH DASHBOARD NOW
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-2 border-border py-12 px-4 sm:px-8 max-w-[95vw] mx-auto w-full flex flex-col sm:flex-row items-center justify-between gap-6 text-xs font-mono text-mutedForeground uppercase tracking-widest">
        <div>
          © 2026 APERTURE • SOLANA TOKEN-2022 AI AGENT TREASURY
        </div>
        <div className="flex gap-6 font-bold">
          <a href="https://github.com/manav2701/Aperture" target="_blank" rel="noreferrer" className="hover:text-accent">GITHUB</a>
          <a href="https://solana.com/docs" target="_blank" rel="noreferrer" className="hover:text-accent">SOLANA DOCS</a>
        </div>
      </footer>

    </div>
  );
}
