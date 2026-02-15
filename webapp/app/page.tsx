'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';

// Force dynamic rendering to avoid prerender errors with Turbopack
export const dynamic = 'force-dynamic';

const TOTAL_FRAMES = 76;
const SCROLL_HEIGHT = 4000;

export default function LandingPage() {
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);

  // Helper functions for text overlay opacity
  const getOpacity1 = (progress: number) => {
    if (progress <= 0.2) return 1;
    if (progress >= 0.3) return 0;
    return 1 - (progress - 0.2) / 0.1;
  };

  const getOpacity2 = (progress: number) => {
    if (progress < 0.2) return 0;
    if (progress >= 0.2 && progress <= 0.3) return (progress - 0.2) / 0.1;
    if (progress >= 0.3 && progress <= 0.45) return 1;
    if (progress >= 0.45 && progress <= 0.55) return 1 - (progress - 0.45) / 0.1;
    return 0;
  };

  const getOpacity3 = (progress: number) => {
    if (progress < 0.45) return 0;
    if (progress >= 0.45 && progress <= 0.55) return (progress - 0.45) / 0.1;
    if (progress >= 0.55 && progress <= 0.70) return 1;
    if (progress >= 0.70 && progress <= 0.80) return 1 - (progress - 0.70) / 0.1;
    return 0;
  };

  const getOpacity4 = (progress: number) => {
    if (progress < 0.70) return 0;
    if (progress >= 0.70 && progress <= 0.80) return (progress - 0.70) / 0.1;
    return 1;
  };

  const getScrollIndicatorOpacity = (progress: number) => {
    return Math.max(0, 1 - progress * 10);
  };

  // Preload all frames
  useEffect(() => {
    const images: HTMLImageElement[] = [];
    let loaded = 0;

    const loadImage = (index: number) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        const paddedIndex = (index + 1).toString().padStart(3, '0');
        img.src = `/frames/ezgif-frame-${paddedIndex}.jpg`;
        
        img.onload = () => {
          loaded++;
          setLoadProgress(Math.floor((loaded / TOTAL_FRAMES) * 100));
          resolve();
        };
        
        img.onerror = () => {
          console.error(`Failed to load frame ${index}`);
          resolve();
        };
        
        images[index] = img;
      });
    };

    Promise.all(
      Array.from({ length: TOTAL_FRAMES }, (_, i) => loadImage(i))
    ).then(() => {
      imagesRef.current = images;
      setImagesLoaded(true);
      console.log(`✅ Loaded ${images.length} frames successfully`);
    });
  }, []);

  // Track scroll position
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      
      const containerTop = containerRef.current.offsetTop;
      const scrolled = window.scrollY - containerTop;
      const progress = Math.max(0, Math.min(1, scrolled / SCROLL_HEIGHT));
      
      setScrollProgress(progress);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Render canvas animation
  useEffect(() => {
    if (!imagesLoaded || !canvasRef.current) return;

    const renderFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const frameIndexNum = Math.floor(scrollProgress * (TOTAL_FRAMES - 1));
      const index = Math.min(Math.max(0, frameIndexNum), TOTAL_FRAMES - 1);
      const img = imagesRef.current[index];
      
      if (!img || !img.complete) return;

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const scale = Math.max(
        canvas.width / img.width,
        canvas.height / img.height
      );
      
      const x = (canvas.width - img.width * scale) / 2;
      const y = (canvas.height - img.height * scale) / 2;

      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    };

    renderFrame();

    const handleResize = () => renderFrame();
    window.addEventListener('resize', handleResize);
    
    return () => window.removeEventListener('resize', handleResize);
  }, [imagesLoaded, scrollProgress]);

  if (!imagesLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="font-mono text-accent text-2xl mb-4 uppercase tracking-widest">
            {'> '}INITIALIZING PERMISSION LAYER...
          </div>
          <div className="w-96 h-1 bg-card border border-border cyber-chamfer-sm overflow-hidden">
            <div 
              className="h-full bg-accent transition-all duration-300 shadow-neon"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <div className="font-mono text-foreground mt-2 text-sm">{loadProgress}% COMPLETE</div>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-page">
      {/* Hero Section with Canvas Animation */}
      <div 
        ref={containerRef}
        className="relative"
        style={{ height: `${SCROLL_HEIGHT}px` }}
      >
        <div className="sticky top-0 h-screen overflow-hidden bg-background">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 opacity-70"
          />

          {/* Dark overlay for better text visibility */}
          <div className="absolute inset-0 bg-linear-to-b from-background/60 via-transparent to-background/90 pointer-events-none" />

          {/* Text Overlay Section 1 - Top Left */}
          <div
            className="absolute top-12 left-12 max-w-2xl transition-opacity duration-500 pointer-events-none"
            style={{ opacity: getOpacity1(scrollProgress) }}
          >
            <div className="inline-block bg-accent/20 px-4 py-2 mb-6">
              <div className="font-mono text-3xl md:text-5xl text-accent uppercase tracking-[0.4em] font-black drop-shadow-[0_0_15px_rgba(0,255,136,0.6)]">
                APERTURE
              </div>
            </div>
            <h1 className="font-mono text-4xl md:text-6xl font-bold uppercase tracking-wider mb-4 text-accent drop-shadow-[0_0_10px_rgba(0,255,136,0.5)]">
              ZERO TRUST POWERS
              <br />
              SAFE AGENT CONTROL
            </h1>
            <p className="font-mono text-base md:text-lg text-mutedForeground leading-relaxed">
              Granular permissions for <span className="text-accent">autonomous AI systems</span>
            </p>
          </div>

          {/* Text Overlay Section 2 - Top Right */}
          <div
            className="absolute top-12 right-12 max-w-2xl text-right transition-opacity duration-500 pointer-events-none"
            style={{ opacity: getOpacity2(scrollProgress) }}
          >
            <div className="font-mono text-xs text-accentSecondary mb-2 uppercase tracking-[0.3em]">
              CHALLENGE.DETECTED{'_'}
            </div>
            <h1 className="font-mono text-4xl md:text-6xl font-bold uppercase tracking-wider mb-4 text-accentSecondary drop-shadow-[0_0_10px_rgba(255,0,255,0.5)]">
              AI AGENTS
              <br />
              NEED PERMISSIONS
            </h1>
            <p className="font-mono text-base md:text-lg text-mutedForeground leading-relaxed">
              Without controls, agents have <span className="text-destructive">unlimited wallet access</span>
            </p>
          </div>

          {/* Text Overlay Section 3 - Center with Permission Layer */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 transition-opacity duration-500"
            style={{ opacity: getOpacity3(scrollProgress) }}
          >
            <div className="inline-block bg-accent/20 px-6 py-3 mb-8 pointer-events-none">
              <div className="font-mono text-4xl md:text-6xl text-accent uppercase tracking-[0.5em] font-black drop-shadow-[0_0_20px_rgba(0,255,136,0.8)]">
                APERTURE
              </div>
            </div>
            <div className="font-mono text-xs text-accentSecondary mb-4 uppercase tracking-[0.3em] pointer-events-none">
              {'>'} ACCESS.GRANTED
            </div>
            <h1 className="font-mono text-5xl md:text-7xl lg:text-8xl font-black uppercase tracking-widest mb-6 text-accent animate-rgb-shift pointer-events-none">
              THE PERMISSION
              <br />
              LAYER
            </h1>
            <p className="font-mono text-xl md:text-2xl text-foreground max-w-3xl mb-12 uppercase tracking-wide pointer-events-none">
              Autonomous agents built on x402 stacks, controlled spending
            </p>
            <div className="transition-opacity duration-500" style={{ opacity: getOpacity3(scrollProgress) }}>
              <Link
                href="/dashboard"
                className="inline-block px-16 py-6 bg-accent text-white font-mono text-2xl font-black uppercase tracking-wider cyber-chamfer hover:brightness-110 transition-all duration-150 shadow-neon-lg border-2 border-accent"
              >
                {'> '}LAUNCH DASHBOARD
              </Link>
            </div>
          </div>

          {/* Text Overlay Section 4 - Removed, merged into Section 3 */}

          {/* Scroll Indicator */}
          <div
            className="absolute bottom-12 left-1/2 -translate-x-1/2 pointer-events-none transition-opacity duration-500"
            style={{ opacity: getScrollIndicatorOpacity(scrollProgress) }}
          >
            <div className="flex flex-col items-center gap-2">
              <div className="text-accent font-mono text-xs uppercase tracking-wider">{'> '}Scroll_</div>
              <div className="w-0.5 h-12 bg-accent shadow-neon">
                <motion.div 
                  className="w-full h-3 bg-accentSecondary shadow-neon-secondary"
                  animate={{ y: [0, 32, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Sections */}
      <div className="bg-background circuit-grid">
        {/* Terminal Header Bar */}
        <div className="w-full border-b border-border bg-card py-4 px-6">
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-destructive"></div>
              <div className="w-3 h-3 rounded-full bg-[#ffcc00]"></div>
              <div className="w-3 h-3 rounded-full bg-accent"></div>
            </div>
            <div className="font-mono text-xs text-mutedForeground uppercase tracking-wider">
              {'> '}x402_policy_manager.exe
            </div>
          </div>
        </div>

        {/* Challenge Section */}
        <section className="py-32 px-4 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <div className="font-mono text-sm text-accent mb-2 uppercase tracking-[0.4em] font-bold text-center">
              {'> '}APERTURE {'_'}
            </div>
            <div className="font-mono text-xs text-accent mb-4 uppercase tracking-[0.3em] text-center">
              {'> '}ERROR.LOG
            </div>
            <motion.h2 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="font-mono text-5xl md:text-7xl text-foreground mb-8 font-black uppercase tracking-wider"
            >
              THE <span className="text-destructive">CHALLENGE</span>
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="font-mono text-lg text-mutedForeground leading-relaxed max-w-4xl mb-16"
            >
              WITHOUT CONTROLS, AI AGENTS HAVE UNLIMITED ACCESS TO WALLETS AND APIS.
              <br />
              THEY CAN <span className="text-destructive">DRAIN FUNDS</span>, ACCESS <span className="text-destructive">UNAUTHORIZED SERVICES</span>, AND OPERATE WITH <span className="text-destructive">ZERO ACCOUNTABILITY</span>.
            </motion.p>
            
            <div className="grid md:grid-cols-3 gap-6 -skew-y-1">
              {[
                { 
                  title: 'UNLIMITED ACCESS', 
                  text: 'AI agents have full wallet control with no spending limits or restrictions',
                  icon: '!'
                },
                { 
                  title: 'NO VISIBILITY', 
                  text: 'Complete lack of tracking and monitoring of agent spending behavior',
                  icon: '!'
                },
                { 
                  title: 'SECURITY RISK', 
                  text: 'Rogue or compromised agents can drain entire wallets without warning',
                  icon: 'X'
                }
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 * i }}
                  whileHover={{ scale: 1.02, y: -4 }}
                  className="p-8 border-2 border-border cyber-chamfer bg-card hover:border-destructive hover:shadow-[0_0_20px_rgba(255,51,102,0.3)] transition-all duration-150 skew-y-1"
                >
                  <div className="text-5xl mb-6 text-destructive opacity-50">{item.icon}</div>
                  <div className="font-mono text-lg text-destructive mb-4 font-bold uppercase tracking-wider">
                    {'> '}{item.title}
                  </div>
                  <p className="font-mono text-sm text-mutedForeground leading-relaxed uppercase tracking-wide">{item.text}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Solution Section */}
        <section className="py-32 px-4 border-t border-border relative overflow-hidden">
          <div className="absolute inset-0 bg-linear-to-br from-accent/5 to-accentSecondary/5 pointer-events-none" />
          <div className="max-w-6xl mx-auto relative z-10">
            <div className="font-mono text-sm text-accent mb-2 uppercase tracking-[0.4em] font-bold text-center">
              {'> '}APERTURE {'_'}
            </div>
            <div className="font-mono text-xs text-accentSecondary mb-4 uppercase tracking-[0.3em] text-center">
              {'> '}SOLUTION.EXEC
            </div>
            <motion.h2 
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="font-mono text-5xl md:text-7xl text-foreground mb-8 font-black uppercase tracking-wider"
            >
              POLICY-BASED <span className="text-accent">CONTROL</span>
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="font-mono text-lg text-mutedForeground leading-relaxed max-w-4xl mb-16 uppercase tracking-wide"
            >
              APERTURE ADDS A <span className="text-accent">PERMISSION LAYER</span> BETWEEN AI AGENTS AND THEIR WALLETS, 
              ENFORCED BY BLOCKCHAIN SMART CONTRACTS.
            </motion.p>

            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  title: 'SPENDING LIMITS',
                  description: 'Set daily, weekly, or per-transaction caps to control agent spending',
                  color: 'accent'
                },
                {
                  title: 'SERVICE APPROVAL',
                  description: 'Whitelist specific APIs and domains that agents can access',
                  color: 'accentTertiary'
                },
                {
                  title: 'AUDIT TRAIL',
                  description: 'Complete payment history stored immutably on Stacks blockchain',
                  color: 'accentSecondary'
                }
              ].map((feature, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 * i }}
                  whileHover={{ scale: 1.02, y: -4 }}
                  className={`p-10 border-2 ${
                    feature.color === 'accent' ? 'border-accent hover:shadow-neon' :
                    feature.color === 'accentTertiary' ? 'border-accentTertiary hover:shadow-neon-tertiary' :
                    'border-accentSecondary hover:shadow-neon-secondary'
                  } cyber-chamfer bg-card/50 backdrop-blur-sm transition-all duration-150`}
                >
                  <h3 className={`font-mono text-xl mb-4 font-bold uppercase tracking-wider ${
                    feature.color === 'accent' ? 'text-accent' :
                    feature.color === 'accentTertiary' ? 'text-accentTertiary' :
                    'text-accentSecondary'
                  }`}>
                    {'> '}{feature.title}
                  </h3>
                  <p className="font-mono text-sm text-mutedForeground leading-relaxed uppercase tracking-wide">
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Architecture Section */}
        <section className="py-32 px-4 border-t border-border bg-muted/30">
          <div className="max-w-6xl mx-auto">
            <div className="font-mono text-xs text-accentTertiary mb-4 uppercase tracking-[0.3em] text-center">
              {'> '}SYSTEM.ARCHITECTURE
            </div>
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-mono text-5xl md:text-7xl text-foreground mb-16 font-black uppercase tracking-wider text-center"
            >
              HOW IT <span className="text-accent">WORKS</span>
            </motion.h2>

            <div className="flex flex-col md:flex-row items-center justify-between gap-8 p-12 border-2 border-border cyber-chamfer bg-card">
              {[
                { label: 'AI AGENT', desc: 'INITIATES REQUEST' },
                { label: 'PROXY LAYER', desc: 'INTERCEPTS CALL', highlight: true },
                { label: 'POLICY CHECK', desc: 'VALIDATES LIMITS', highlight: true },
                { label: 'API CALL', desc: 'EXECUTES IF APPROVED' }
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-8">
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 * i }}
                    className={`text-center ${step.highlight ? 'scale-110' : ''}`}
                  >
                    <div className={`p-6 cyber-chamfer-sm border-2 ${
                      step.highlight 
                        ? 'border-accent bg-muted shadow-neon' 
                        : 'border-border bg-background'
                    }`}>
                      <div className={`font-mono text-lg font-bold uppercase tracking-wider mb-2 ${
                        step.highlight ? 'text-accent' : 'text-foreground'
                      }`}>
                        {step.label}
                      </div>
                      <div className="text-xs text-mutedForeground uppercase tracking-wider">{step.desc}</div>
                    </div>
                  </motion.div>
                  {i < 3 && (
                    <div className="hidden md:block text-3xl text-border">→</div>
                  )}
                </div>
              ))}
            </div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-16 p-8 border-2 border-accent cyber-chamfer bg-card shadow-neon"
            >
              <h3 className="font-mono text-2xl text-accent mb-4 font-bold uppercase tracking-wider">
                {'> '}BUILT ON STACKS BLOCKCHAIN
              </h3>
              <p className="font-mono text-base text-mutedForeground leading-relaxed uppercase tracking-wide">
                EVERY POLICY IS ENFORCED BY CLARITY SMART CONTRACTS, ENSURING IMMUTABLE, 
                TRANSPARENT, AND DECENTRALIZED ACCESS CONTROL.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Tech Stack */}
        <section className="py-32 px-4 border-t border-border">
          <div className="max-w-6xl mx-auto text-center">
            <div className="font-mono text-xs text-accent mb-4 uppercase tracking-[0.3em]">
              {'> '}TECH.STACK
            </div>
            <motion.h2 
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="font-mono text-4xl text-foreground mb-12 font-bold uppercase tracking-wider"
            >
              POWERED BY
            </motion.h2>
            <div className="flex flex-wrap justify-center gap-4">
              {[
                'STACKS',
                'CLARITY',
                'SUPABASE',
                'NEXT.JS',
                'TYPESCRIPT'
              ].map((tech, i) => (
                <motion.div
                  key={tech}
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.05 * i }}
                  whileHover={{ scale: 1.05 }}
                  className="px-8 py-4 border-2 border-border cyber-chamfer-sm font-mono text-lg text-foreground hover:border-accent hover:shadow-neon transition-all duration-150 uppercase tracking-wider"
                >
                  {tech}
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Company Use Cases Section */}
        <section className="py-32 px-4 border-t border-border bg-muted/10">
          <div className="max-w-6xl mx-auto">
            <div className="font-mono text-sm text-accent mb-2 uppercase tracking-[0.4em] font-bold text-center">
              {'> '}APERTURE {'_'}
            </div>
            <div className="font-mono text-xs text-accentSecondary mb-4 uppercase tracking-[0.3em] text-center">
              {'> '}USE.CASES
            </div>
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-mono text-5xl md:text-7xl text-foreground mb-8 font-black uppercase tracking-wider text-center"
            >
              WHO <span className="text-accent">NEEDS THIS</span>
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="font-mono text-lg text-mutedForeground leading-relaxed max-w-4xl mb-16 uppercase tracking-wide text-center mx-auto"
            >
              FROM STARTUPS TO ENTERPRISES, TEAMS USING AI AGENTS NEED SPENDING CONTROLS
            </motion.p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                {
                  title: 'STARTUPS',
                  description: 'MULTIPLE DEVELOPERS SHARING COMPANY WALLET. SET INDIVIDUAL SPENDING LIMITS PER AGENT WITHOUT MANAGING SEPARATE ACCOUNTS.',
                  icon: '🚀',
                  color: 'accent'
                },
                {
                  title: 'AGENCIES',
                  description: 'MANAGE CLIENT WORKFLOWS WITH AI AGENTS. TRACK AND BILL API USAGE PER CLIENT WITH COMPLETE TRANSPARENCY.',
                  icon: '🏢',
                  color: 'accentTertiary'
                },
                {
                  title: 'ENTERPRISES',
                  description: 'FINOPS FOR AI AGENTS. DEPARTMENT-LEVEL BUDGETS, REAL-TIME MONITORING, AND COMPLIANCE-READY AUDIT TRAILS.',
                  icon: '🏛️',
                  color: 'accentSecondary'
                },
                {
                  title: 'DAOs',
                  description: 'DECENTRALIZED COORDINATION OF AUTONOMOUS AGENTS. BLOCKCHAIN-ENFORCED POLICIES THAT NO SINGLE MEMBER CAN BYPASS.',
                  icon: '⚡',
                  color: 'accent'
                },
                {
                  title: 'AI LABS',
                  description: 'RESEARCH TEAMS TESTING MULTIPLE AGENTS. PREVENT RUNAWAY COSTS DURING EXPERIMENTATION WITH AUTOMATIC LIMITS.',
                  icon: '🔬',
                  color: 'accentTertiary'
                },
                {
                  title: 'WEB3 BUILDERS',
                  description: 'INTEGRATE AI AGENTS INTO DAPPS. X402 PROVIDES THE PERMISSION LAYER YOUR SMART CONTRACTS RELY ON.',
                  icon: '🛠️',
                  color: 'accentSecondary'
                }
              ].map((useCase, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 * i }}
                  whileHover={{ scale: 1.02, y: -4 }}
                  className={`p-8 border-2 ${
                    useCase.color === 'accent' ? 'border-accent hover:shadow-neon' :
                    useCase.color === 'accentTertiary' ? 'border-accentTertiary hover:shadow-neon-tertiary' :
                    'border-accentSecondary hover:shadow-neon-secondary'
                  } cyber-chamfer bg-card transition-all duration-150`}
                >
                  <div className="text-5xl mb-6 opacity-70">{useCase.icon}</div>
                  <h3 className={`font-mono text-xl mb-4 font-bold uppercase tracking-wider ${
                    useCase.color === 'accent' ? 'text-accent' :
                    useCase.color === 'accentTertiary' ? 'text-accentTertiary' :
                    'text-accentSecondary'
                  }`}>
                    {'> '}{useCase.title}
                  </h3>
                  <p className="font-mono text-sm text-mutedForeground leading-relaxed uppercase tracking-wide">
                    {useCase.description}
                  </p>
                </motion.div>
              ))}
            </div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-16 p-10 border-2 border-accent cyber-chamfer bg-card/50 backdrop-blur-sm shadow-neon"
            >
              <h3 className="font-mono text-3xl text-accent mb-6 font-bold uppercase tracking-wider text-center">
                {'> '}WHY WALLET-BASED CONTROL MATTERS
              </h3>
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <div className="font-mono text-lg text-destructive mb-3 font-bold uppercase tracking-wider">
                    ❌ TRADITIONAL APPROACH
                  </div>
                  <ul className="font-mono text-sm text-mutedForeground space-y-2 uppercase tracking-wide">
                    <li>• RATE LIMITS IN WORKFLOW CODE (BYPASSABLE)</li>
                    <li>• API KEYS CAN BE SHARED OR ROTATED</li>
                    <li>• NO CENTRALIZED VISIBILITY</li>
                    <li>• DEVELOPERS CAN MODIFY WORKFLOWS</li>
                  </ul>
                </div>
                <div>
                  <div className="font-mono text-lg text-accent mb-3 font-bold uppercase tracking-wider">
                    ✅ X402 APPROACH
                  </div>
                  <ul className="font-mono text-sm text-mutedForeground space-y-2 uppercase tracking-wide">
                    <li>• LIMITS IN WALLET (IMPOSSIBLE TO BYPASS)</li>
                    <li>• CRYPTOGRAPHIC IDENTITY TIED TO SPENDING</li>
                    <li>• REAL-TIME COMPANY DASHBOARD</li>
                    <li>• ECONOMIC-LAYER ENFORCEMENT</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-32 px-4 border-t border-accent bg-accent/5">
          <div className="max-w-4xl mx-auto text-center">
            <div className="font-mono text-xs text-accent mb-6 uppercase tracking-[0.3em]">
              {'> '}INITIALIZE.NOW
            </div>
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-mono text-5xl md:text-7xl text-foreground mb-8 font-black uppercase tracking-wider"
            >
              START CONTROLLING
              <br />
              <span className="text-accent">YOUR AI AGENTS</span>
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="font-mono text-lg text-mutedForeground mb-12 leading-relaxed uppercase tracking-wide"
            >
              TAKE CONTROL OF AI AGENT SPENDING WITH BLOCKCHAIN-ENFORCED POLICIES.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="flex flex-col sm:flex-row gap-4 justify-center"
            >
              <Link
                href="/agents"
                className="inline-block px-16 py-6 bg-accent text-white font-mono text-2xl font-black uppercase tracking-wider cyber-chamfer hover:brightness-110 transition-all duration-150 shadow-neon-lg border-2 border-accent"
              >
                {'> '}LAUNCH YOUR AGENT
              </Link>
              <a
                href="https://github.com/manav2701/Aperture"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-16 py-6 border-2 border-accent text-accent font-mono text-2xl font-black uppercase tracking-wider cyber-chamfer hover:bg-accent hover:text-background transition-all duration-150"
              >
                VIEW SOURCE CODE
              </a>
            </motion.div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-16 px-4 border-t border-border bg-card">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="font-mono text-mutedForeground uppercase tracking-wider">
              © 2026 APERTURE • X402_POLICY_MANAGER
            </div>
            <div className="flex gap-6">
              <a
                href="https://github.com/manav2701/Aperture"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-accent transition-colors font-mono uppercase tracking-wider"
              >
                GITHUB
              </a>
              <span className="text-border">|</span>
              <span className="font-mono uppercase tracking-wider text-accent">
                BUILT FOR STACKS HACKATHON
              </span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
