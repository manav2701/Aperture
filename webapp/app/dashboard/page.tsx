'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface ActivityItem {
  id: string;
  agentName: string;
  model: string;
  cost: string;
  status: string;
  timestamp: string;
}

interface Stats {
  totalAgents: number;
  totalKeysGenerated: number;
  totalSpentUsd: number;
  pendingApprovals: number;
}

export default function Dashboard() {
  const { isConnected, publicKey } = useWallet();
  const [stats, setStats] = useState<Stats>({ totalAgents: 0, totalKeysGenerated: 0, totalSpentUsd: 0, pendingApprovals: 0 });
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [keysResult, logsResult, escalatedResult] = await Promise.all([
          supabase.from('agent_virtual_keys').select('id, agent_address, daily_limit_usd', { count: 'exact' }),
          supabase.from('agent_request_logs').select('*').order('created_at', { ascending: false }).limit(8),
          supabase.from('agent_request_logs').select('id', { count: 'exact' }).eq('status', 'ESCALATED_PENDING'),
        ]);

        const totalKeys = keysResult.count || 0;
        const logs = logsResult.data || [];
        const pending = escalatedResult.count || 0;

        const totalSpent = logs.reduce((sum: number, l: any) => sum + (parseFloat(l.cost_usd) || 0), 0);

        setStats({
          totalAgents: totalKeys,
          totalKeysGenerated: totalKeys,
          totalSpentUsd: totalSpent,
          pendingApprovals: pending,
        });

        setRecentActivity(
          logs.map((l: any) => ({
            id: l.id,
            agentName: l.virtual_api_key ? `${l.virtual_api_key.slice(0, 12)}...` : 'AI Agent',
            model: l.model_slug || 'openai/gpt-4o',
            cost: `$${(parseFloat(l.cost_usd) || 0).toFixed(4)}`,
            status: l.status || 'APPROVED',
            timestamp: new Date(l.created_at).toLocaleTimeString(),
          }))
        );
      } catch (err) {
        console.warn('Dashboard load error:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [publicKey]);

  if (!isConnected) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full border-2 border-border p-10 text-center space-y-6 bg-background">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <h2 className="text-xl font-bold font-mono text-foreground uppercase tracking-tighter">
            Connect Your Wallet to Continue
          </h2>
          <p className="text-xs font-mono text-mutedForeground uppercase tracking-tight">
            Connect your wallet to access your agent dashboard and spending controls.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <p className="text-accent font-mono text-xs uppercase tracking-widest animate-pulse">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">

      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-background">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-3 h-3 bg-accent animate-pulse" />
            <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter">
              Overview
            </h1>
          </div>
          <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest">
            {publicKey ? `${publicKey.toBase58().slice(0, 6)}...${publicKey.toBase58().slice(-4)}` : 'Your Aperture Account'}
            {' '}&bull; All AI agents across all providers
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href="/gateway" className="kinetic-btn-primary px-5 py-2.5 text-xs tracking-tighter">
            + New AI Agent Key
          </Link>
          <Link href="/approvals" className="px-5 py-2.5 border-2 border-border text-xs font-mono font-bold uppercase hover:bg-muted transition-all">
            Approvals {stats.pendingApprovals > 0 && <span className="text-accent">({stats.pendingApprovals})</span>}
          </Link>
        </div>
      </div>

      {/* Key Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="kinetic-card p-6 relative overflow-hidden group">
          <span className="absolute -right-2 -bottom-6 text-[6rem] font-mono font-black text-muted/20 select-none">01</span>
          <div className="relative z-10 space-y-1">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">Active Agents</span>
            <div className="text-3xl font-mono font-bold text-accent">{stats.totalAgents}</div>
            <p className="text-[10px] font-mono text-mutedForeground uppercase">AI agents with access keys</p>
          </div>
        </div>

        <div className="kinetic-card p-6 relative overflow-hidden group">
          <span className="absolute -right-2 -bottom-6 text-[6rem] font-mono font-black text-muted/20 select-none">02</span>
          <div className="relative z-10 space-y-1">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">Total Spent Today</span>
            <div className="text-3xl font-mono font-bold text-foreground">${stats.totalSpentUsd.toFixed(4)}</div>
            <p className="text-[10px] font-mono text-mutedForeground uppercase">Across all agents</p>
          </div>
        </div>

        <div className="kinetic-card p-6 relative overflow-hidden group">
          <span className="absolute -right-2 -bottom-6 text-[6rem] font-mono font-black text-muted/20 select-none">03</span>
          <div className="relative z-10 space-y-1">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">Pending Approvals</span>
            <div className={`text-3xl font-mono font-bold ${stats.pendingApprovals > 0 ? 'text-amber-400' : 'text-accent'}`}>
              {stats.pendingApprovals}
            </div>
            <p className="text-[10px] font-mono text-mutedForeground uppercase">Requests waiting for review</p>
          </div>
        </div>

        <div className="kinetic-card p-6 relative overflow-hidden group">
          <span className="absolute -right-2 -bottom-6 text-[6rem] font-mono font-black text-muted/20 select-none">04</span>
          <div className="relative z-10 space-y-1">
            <span className="text-xs font-mono text-mutedForeground uppercase tracking-widest block">AI Hub Status</span>
            <div className="text-2xl font-mono font-bold text-accent uppercase tracking-tighter">Online</div>
            <p className="text-[10px] font-mono text-mutedForeground uppercase">GPT-4o, Claude, Gemini ready</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/gateway" className="kinetic-card p-8 group">
          <div className="text-xs font-mono text-accent font-bold uppercase tracking-widest mb-2">[→] CONNECT</div>
          <h3 className="font-mono text-2xl font-bold uppercase tracking-tighter mb-2">AI Hub</h3>
          <p className="text-xs font-mono text-mutedForeground leading-relaxed uppercase">
            Create and manage agent keys. Set daily budgets and choose which AI models each agent can use.
          </p>
        </Link>

        <Link href="/policies" className="kinetic-card p-8 group">
          <div className="text-xs font-mono text-accent font-bold uppercase tracking-widest mb-2">[→] CONTROL</div>
          <h3 className="font-mono text-2xl font-bold uppercase tracking-tighter mb-2">Spending Rules</h3>
          <p className="text-xs font-mono text-mutedForeground leading-relaxed uppercase">
            Set daily limits, max per request, and require approval before agents can spend above a threshold.
          </p>
        </Link>

        <Link href="/audit" className="kinetic-card p-8 group">
          <div className="text-xs font-mono text-accent font-bold uppercase tracking-widest mb-2">[→] INSPECT</div>
          <h3 className="font-mono text-2xl font-bold uppercase tracking-tighter mb-2">Activity History</h3>
          <p className="text-xs font-mono text-mutedForeground leading-relaxed uppercase">
            Every AI request your agents make — model used, cost, whether it was approved or blocked.
          </p>
        </Link>
      </div>

      {/* Recent Activity */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold uppercase tracking-tighter">&gt; Recent Agent Requests</h2>
          <Link href="/audit" className="text-xs font-mono text-accent font-bold uppercase hover:underline">View All</Link>
        </div>

        {recentActivity.length > 0 ? (
          <div className="divide-y-2 divide-border">
            {recentActivity.map((item) => (
              <div key={item.id} className="py-4 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 font-bold uppercase border ${
                        item.status === 'APPROVED'
                          ? 'border-accent text-accent bg-accent/10'
                          : item.status.includes('ESCALATED')
                          ? 'border-amber-400 text-amber-400 bg-amber-400/10'
                          : 'border-destructive text-destructive bg-destructive/10'
                      }`}
                    >
                      {item.status === 'APPROVED' ? 'Approved' :
                       item.status.includes('ESCALATED') ? 'Needs Approval' :
                       item.status.replace('BLOCKED_', '').replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm font-mono font-bold">{item.agentName}</span>
                  </div>
                  <p className="text-[11px] font-mono text-mutedForeground">Model: {item.model}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-mono font-bold text-accent">{item.cost}</div>
                  <div className="text-[10px] font-mono text-mutedForeground">{item.timestamp}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center space-y-3">
            <div className="text-3xl font-mono text-accent font-bold">[!]</div>
            <h3 className="font-mono text-lg font-bold uppercase tracking-tighter">No Activity Yet</h3>
            <p className="text-xs font-mono text-mutedForeground max-w-sm mx-auto uppercase">
              Once your AI agents start making requests through the AI Hub, they'll appear here.
            </p>
            <Link href="/gateway" className="kinetic-btn-primary inline-block mt-2 px-6 py-3 text-xs tracking-tighter">
              Set Up Your First Agent
            </Link>
          </div>
        )}
      </div>

    </div>
  );
}
