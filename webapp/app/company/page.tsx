'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { microSTXtoSTX } from '@/lib/stacks';
import { HiServer, HiChartBar, HiFire, HiShieldCheck, HiSearch, HiLightningBolt } from 'react-icons/hi';

interface AgentStats {
  agent_address: string;
  totalSpent: number;
  paymentsCount: number;
  dailyLimit: number;
  isPaused: boolean;
  isRevoked: boolean;
  lastActivity: string | null;
}

export default function CompanyDashboard() {
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCompanyData = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];

        // Get all policies (all agents in the system)
        const { data: policies } = await supabase
          .from('policies')
          .select('*')
          .eq('is_active', true);

        if (!policies) return;

        // Get spending for each agent
        const agentStats: AgentStats[] = [];

        for (const policy of policies) {
          const { data: payments } = await supabase
            .from('payment_history')
            .select('*')
            .eq('agent_address', policy.agent_address)
            .eq('approved', true)
            .gte('created_at', today);

          const totalSpent = payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
          const lastPayment = payments?.[0];

          agentStats.push({
            agent_address: policy.agent_address,
            totalSpent,
            paymentsCount: payments?.length || 0,
            dailyLimit: policy.daily_limit_stx,
            isPaused: policy.is_paused,
            isRevoked: policy.is_revoked,
            lastActivity: lastPayment?.created_at || null,
          });
        }

        // Sort by spending (highest first)
        agentStats.sort((a, b) => b.totalSpent - a.totalSpent);

        setAgents(agentStats);
        setLoading(false);
      } catch (error) {
        console.error('Error loading company data:', error);
        setLoading(false);
      }
    };

    loadCompanyData();
    const interval = setInterval(loadCompanyData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (agent: AgentStats) => {
    if (agent.isRevoked) return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Revoked</span>;
    if (agent.isPaused) return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Paused</span>;
    if (agent.totalSpent >= agent.dailyLimit) return <span className="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-800">Limit Reached</span>;
    return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Active</span>;
  };

  const getUtilization = (spent: number, limit: number) => {
    return Math.min((spent / limit) * 100, 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading company dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background circuit-grid">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-mono text-4xl font-bold text-foreground mb-2 uppercase tracking-wider">
            {'> '}COMPANY DASHBOARD
          </h1>
          <p className="font-mono text-mutedForeground uppercase tracking-wide">MONITOR ALL AI AGENTS ACROSS YOUR ORGANIZATION</p>
        </div>

        {/* Company-Wide Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-card cyber-chamfer border-2 border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-mono text-mutedForeground uppercase tracking-wider">Active Agents</h3>
              <HiServer className="w-6 h-6 text-accent" />
            </div>
            <p className="text-4xl font-bold font-mono text-accent">{agents.length}</p>
            <p className="text-sm font-mono text-mutedForeground mt-2">
              {agents.filter(a => !a.isPaused && !a.isRevoked).length} operational
            </p>
          </div>

          <div className="bg-card cyber-chamfer border-2 border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-mono text-mutedForeground uppercase tracking-wider">Total Transactions Today</h3>
              <HiChartBar className="w-6 h-6 text-accent" />
            </div>
            <p className="text-4xl font-bold font-mono text-accent">
              {agents.reduce((sum, a) => sum + a.paymentsCount, 0)}
            </p>
            <p className="text-sm font-mono text-mutedForeground mt-2">Across all agents</p>
          </div>
        </div>

        {/* Agents Table */}
        <div className="bg-card cyber-chamfer border-2 border-border overflow-hidden shadow-neon-sm">
          <div className="px-6 py-4 border-b-2 border-border bg-muted">
            <h2 className="font-mono text-xl font-bold text-accent uppercase tracking-wider">{'> '}AGENT ACTIVITY</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-background/50 border-b-2 border-border">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-mutedForeground uppercase tracking-wider">
                    Agent Address
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-mutedForeground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-mutedForeground uppercase tracking-wider">
                    Spent Today
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-mutedForeground uppercase tracking-wider">
                    Limit Utilization
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-mutedForeground uppercase tracking-wider">
                    Payments
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-mutedForeground uppercase tracking-wider">
                    Last Activity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {agents.map((agent) => {
                  const utilization = getUtilization(agent.totalSpent, agent.dailyLimit);
                  return (
                    <tr key={agent.agent_address} className="hover:bg-background/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <div className="text-sm font-mono text-foreground">
                            {agent.agent_address.slice(0, 8)}...{agent.agent_address.slice(-6)}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(agent)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-mono text-sm font-bold text-accent">
                          {microSTXtoSTX(agent.totalSpent).toFixed(6)} STX
                        </div>
                        <div className="font-mono text-xs text-mutedForeground">
                          of {microSTXtoSTX(agent.dailyLimit).toFixed(2)} limit
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-2">
                          <div className="font-mono text-sm font-bold text-foreground">{utilization.toFixed(0)}%</div>
                          <div className="w-full bg-background/50 h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                utilization >= 90 ? 'bg-destructive' :
                                utilization >= 70 ? 'bg-yellow-500' :
                                'bg-accent'
                              }`}
                              style={{ width: `${Math.min(utilization, 100)}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {agent.paymentsCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        {agent.lastActivity ? new Date(agent.lastActivity).toLocaleTimeString() : 'Never'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 bg-accent/10 border-2 border-accent cyber-chamfer p-8 shadow-neon">
          <h3 className="font-mono text-2xl font-bold mb-4 text-accent uppercase tracking-wider flex items-center gap-2">
            <HiFire className="w-7 h-7" />
            TEAM-BASED AI SPENDING CONTROL
          </h3>
          <p className="font-mono text-foreground/90 mb-6 uppercase tracking-wide">
            YOUR ORGANIZATION USES A SHARED WALLET. EACH DEVELOPER GETS AN AI AGENT WITH INDIVIDUAL SPENDING LIMITS.
            POLICY ENFORCEMENT HAPPENS AT THE ECONOMIC LAYER — IMPOSSIBLE TO BYPASS, EVEN IF WORKFLOWS ARE MODIFIED.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-background/10 cyber-chamfer-sm border border-accent/50 p-4 backdrop-blur">
              <HiShieldCheck className="w-10 h-10 text-accent mb-2" />
              <div className="font-mono font-semibold text-foreground uppercase tracking-wide">CENTRALIZED CONTROL</div>
              <div className="text-sm font-mono text-mutedForeground uppercase tracking-wide">SET LIMITS ONCE, ENFORCE EVERYWHERE</div>
            </div>
            <div className="bg-background/10 cyber-chamfer-sm border border-accent/50 p-4 backdrop-blur">
              <HiSearch className="w-10 h-10 text-accent mb-2" />
              <div className="font-mono font-semibold text-foreground uppercase tracking-wide">FULL VISIBILITY</div>
              <div className="text-sm font-mono text-mutedForeground uppercase tracking-wide">TRACK EVERY API CALL IN REAL-TIME</div>
            </div>
            <div className="bg-background/10 cyber-chamfer-sm border border-accent/50 p-4 backdrop-blur">
              <HiLightningBolt className="w-10 h-10 text-accent mb-2" />
              <div className="font-mono font-semibold text-foreground uppercase tracking-wide">INSTANT ENFORCEMENT</div>
              <div className="text-sm font-mono text-mutedForeground uppercase tracking-wide">PAUSE AGENTS IMMEDIATELY WHEN NEEDED</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
