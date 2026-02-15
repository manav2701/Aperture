// webapp/app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import { microSTXtoSTX, satoshisToBTC } from '@/lib/stacks';
import EmergencyControls from '@/components/EmergencyControls';

interface Payment {
  id: string;
  amount: number;
  asset_type: 'STX' | 'sBTC';
  created_at: string;
  tx_id: string;
  session_id: string;
  api_endpoint: string;
}

interface Stats {
  totalSpentToday: {
    stx: number;
    sbtc: number;
  };
  paymentsToday: number;
  activeSessions: number;
  avgCostPerRequest: number;
}

export default function Dashboard() {
  const { address, isConnected } = useWallet();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalSpentToday: { stx: 0, sbtc: 0 },
    paymentsToday: 0,
    activeSessions: 0,
    avgCostPerRequest: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConnected || !address) return;

    async function loadData() {
      try {
        // Get today's payments
        const today = new Date().toISOString().split('T')[0];
        const { data: paymentsData, error: paymentsError } = await supabase
          .from('payment_history')
          .select('*')
          .eq('agent_address', address)
          .gte('created_at', today)
          .order('created_at', { ascending: false })
          .limit(10);

        if (paymentsError) throw paymentsError;

        setPayments(paymentsData || []);

        // Calculate stats
        const stxSpent =
          paymentsData
            ?.filter((p) => p.asset_type === 'STX')
            .reduce((sum, p) => sum + p.amount, 0) || 0;
        const sbtcSpent =
          paymentsData
            ?.filter((p) => p.asset_type === 'sBTC')
            .reduce((sum, p) => sum + p.amount, 0) || 0;

        // Get active sessions
        const { data: sessionsData } = await supabase
          .from('agent_sessions')
          .select('id')
          .eq('agent_address', address)
          .eq('is_active', true);

        const avgCost =
          paymentsData && paymentsData.length > 0
            ? (stxSpent + sbtcSpent * 100000000) / paymentsData.length
            : 0;

        setStats({
          totalSpentToday: {
            stx: microSTXtoSTX(stxSpent),
            sbtc: satoshisToBTC(sbtcSpent),
          },
          paymentsToday: paymentsData?.length || 0,
          activeSessions: sessionsData?.length || 0,
          avgCostPerRequest: microSTXtoSTX(avgCost),
        });

        setLoading(false);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
        setLoading(false);
      }
    }

    // Initial load
    loadData();

    // 🔥 REAL-TIME: Subscribe to new payments
    const channel = supabase
      .channel('payment-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'payment_history',
          filter: `agent_address=eq.${address}`,
        },
        (payload) => {
          console.log('🔥 New payment detected:', payload.new);
          const newPayment = payload.new as Payment;
          
          // Add to payments list
          setPayments(prev => [newPayment, ...prev.slice(0, 9)]);
          
          // Update stats
          setStats((prev) => ({
            ...prev,
            totalSpentToday: {
              stx:
                prev.totalSpentToday.stx +
                (newPayment.asset_type === 'STX'
                  ? microSTXtoSTX(newPayment.amount)
                  : 0),
              sbtc:
                prev.totalSpentToday.sbtc +
                (newPayment.asset_type === 'sBTC'
                  ? satoshisToBTC(newPayment.amount)
                  : 0),
            },
            paymentsToday: prev.paymentsToday + 1,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [address, isConnected]);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-black flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-black/40 backdrop-blur-xl border-2 border-primary/30 cyber-chamfer-lg p-12 text-center shadow-[0_0_50px_rgba(255,51,102,0.3)]">
          <div className="w-20 h-20 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold text-primary mb-4 font-mono uppercase tracking-wider">
            ACCESS DENIED
          </h2>
          <p className="text-gray-400 mb-6 font-mono">
            Connect your wallet to access the dashboard
          </p>
          <div className="h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-black flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-24 h-24 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-6 shadow-[0_0_30px_rgba(255,51,102,0.5)]"></div>
          <p className="text-primary font-mono text-lg uppercase tracking-widest animate-pulse">
            LOADING SYSTEMS...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-black p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-black/40 backdrop-blur-xl border-2 border-primary/30 cyber-chamfer-lg p-8 shadow-[0_0_30px_rgba(255,51,102,0.2)]">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-3 h-3 bg-primary rounded-full animate-pulse shadow-[0_0_10px_rgba(255,51,102,0.8)]"></div>
            <h1 className="text-4xl font-bold text-primary font-mono uppercase tracking-wider">
              AGENT DASHBOARD
            </h1>
          </div>
          <p className="text-gray-400 font-mono text-sm">
            Real-time spending monitoring system
          </p>
          <div className="mt-4 p-3 bg-primary/10 border border-primary/30 cyber-chamfer-sm">
            <p className="text-xs text-gray-400 font-mono">
              AGENT ID:{' '}
              <span className="text-primary">
                {address?.slice(0, 8)}...{address?.slice(-6)}
              </span>
            </p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* STX Spent Today */}
          <div className="bg-black/40 backdrop-blur-xl border-2 border-primary/30 cyber-chamfer-lg p-6 hover:border-primary/50 transition-all hover:shadow-[0_0_30px_rgba(255,51,102,0.3)]">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-400 font-mono uppercase tracking-wider">
                STX SPENT TODAY
              </p>
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
            </div>
            <p className="text-3xl font-bold text-primary font-mono">
              {stats.totalSpentToday.stx.toFixed(6)}
            </p>
            <div className="mt-3 h-1 bg-gradient-to-r from-primary/50 to-transparent"></div>
          </div>

          {/* sBTC Spent Today */}
          <div className="bg-black/40 backdrop-blur-xl border-2 border-orange-500/30 cyber-chamfer-lg p-6 hover:border-orange-500/50 transition-all hover:shadow-[0_0_30px_rgba(255,140,0,0.3)]">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-400 font-mono uppercase tracking-wider">
                sBTC SPENT TODAY
              </p>
              <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
            </div>
            <p className="text-3xl font-bold text-orange-500 font-mono">
              {stats.totalSpentToday.sbtc.toFixed(8)}
            </p>
            <div className="mt-3 h-1 bg-gradient-to-r from-orange-500/50 to-transparent"></div>
          </div>

          {/* Total Payments */}
          <div className="bg-black/40 backdrop-blur-xl border-2 border-green-500/30 cyber-chamfer-lg p-6 hover:border-green-500/50 transition-all hover:shadow-[0_0_30px_rgba(0,255,0,0.3)]">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-400 font-mono uppercase tracking-wider">
                TRANSACTIONS
              </p>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            </div>
            <p className="text-3xl font-bold text-green-500 font-mono">
              {stats.paymentsToday}
            </p>
            <div className="mt-3 h-1 bg-gradient-to-r from-green-500/50 to-transparent"></div>
          </div>

          {/* Active Sessions */}
          <div className="bg-black/40 backdrop-blur-xl border-2 border-blue-500/30 cyber-chamfer-lg p-6 hover:border-blue-500/50 transition-all hover:shadow-[0_0_30px_rgba(0,150,255,0.3)]">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-400 font-mono uppercase tracking-wider">
                ACTIVE SESSIONS
              </p>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            </div>
            <p className="text-3xl font-bold text-blue-500 font-mono">
              {stats.activeSessions}
            </p>
            <div className="mt-3 h-1 bg-gradient-to-r from-blue-500/50 to-transparent"></div>
          </div>
        </div>

        {/* Emergency Controls */}
        <div className="bg-black/40 backdrop-blur-xl border-2 border-destructive/30 cyber-chamfer-lg p-6 shadow-[0_0_30px_rgba(255,51,102,0.2)]">
          <EmergencyControls />
        </div>

        {/* Recent Payments */}
        <div className="bg-black/40 backdrop-blur-xl border-2 border-primary/30 cyber-chamfer-lg p-6 shadow-[0_0_30px_rgba(255,51,102,0.2)]">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-1 h-6 bg-primary shadow-[0_0_10px_rgba(255,51,102,0.8)]"></div>
            <h2 className="text-2xl font-bold text-primary font-mono uppercase tracking-wider">
              RECENT TRANSACTIONS
            </h2>
          </div>

          {payments.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-700 cyber-chamfer-sm">
              <p className="text-gray-500 font-mono">NO TRANSACTIONS DETECTED</p>
            </div>
          ) : (
            <div className="space-y-3">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="bg-black/60 border border-primary/20 cyber-chamfer-sm p-4 hover:border-primary/40 transition-all hover:shadow-[0_0_20px_rgba(255,51,102,0.2)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`px-2 py-1 text-xs font-mono font-bold cyber-chamfer-sm ${
                            payment.asset_type === 'STX'
                              ? 'bg-primary/20 text-primary border border-primary/30'
                              : 'bg-orange-500/20 text-orange-500 border border-orange-500/30'
                          }`}
                        >
                          {payment.asset_type}
                        </span>
                        <span className="text-sm text-gray-500 font-mono">
                          {new Date(payment.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 font-mono mb-1 truncate">
                        ENDPOINT: {payment.api_endpoint}
                      </p>
                      <p className="text-xs text-gray-500 font-mono truncate">
                        SESSION: {payment.session_id}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-primary font-mono">
                        {payment.asset_type === 'STX'
                          ? microSTXtoSTX(payment.amount).toFixed(6)
                          : satoshisToBTC(payment.amount).toFixed(8)}
                      </p>
                      <a
                        href={`https://explorer.stacks.co/txid/${payment.tx_id}?chain=testnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:text-primary/80 font-mono underline"
                      >
                        VIEW TX →
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
