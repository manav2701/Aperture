'use client';

import { useState, useEffect } from 'react';

// Force dynamic rendering to avoid prerender errors with Turbopack
export const dynamic = 'force-dynamic';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import { microSTXtoSTX, satoshisToBTC, getExplorerTxUrl } from '@/lib/stacks';
import { format } from 'date-fns';

interface Payment {
  id: string;
  agent_address: string;
  amount: number;
  asset_type: string;
  service_url: string;
  transaction_id: string | null;
  approved: boolean;
  block_height: number | null;
  created_at: string;
}

export default function AuditPage() {
  const { address, isConnected } = useWallet();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'approved' | 'blocked'>('all');
  const [assetFilter, setAssetFilter] = useState<'all' | 'STX' | 'sBTC'>('all');

  useEffect(() => {
    if (!address) return;

    async function loadPayments() {
      let query = supabase
        .from('payment_history')
        .select('*')
        .eq('agent_address', address)
        .order('created_at', { ascending: false });

      if (filter === 'approved') {
        query = query.eq('approved', true);
      } else if (filter === 'blocked') {
        query = query.eq('approved', false);
      }

      if (assetFilter !== 'all') {
        query = query.eq('asset_type', assetFilter);
      }

      const { data } = await query;

      if (data) {
        setPayments(data);
      }
      setLoading(false);
    }

    loadPayments();
  }, [address, filter, assetFilter]);

  const exportCSV = () => {
    const csv = [
      ['Timestamp', 'Service', 'Amount', 'Asset', 'Status', 'Transaction ID', 'Block Height'].join(','),
      ...payments.map(p => [
        format(new Date(p.created_at), 'yyyy-MM-dd HH:mm:ss'),
        p.service_url,
        p.asset_type === 'STX' ? microSTXtoSTX(p.amount) : satoshisToBTC(p.amount),
        p.asset_type,
        p.approved ? 'Approved' : 'Blocked',
        p.transaction_id || 'N/A',
        p.block_height || 'N/A'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${Date.now()}.csv`;
    a.click();
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="font-mono text-2xl font-bold text-foreground mb-4 uppercase tracking-wider">{'> '}CONNECT WALLET</h2>
          <p className="font-mono text-mutedForeground uppercase tracking-wide">PLEASE CONNECT YOUR WALLET TO VIEW AUDIT LOG</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-600">Loading audit log...</p>
        </div>
      </div>
    );
  }

  // Calculate stats
  const totalApproved = payments.filter(p => p.approved).length;
  const totalBlocked = payments.filter(p => !p.approved).length;
  const totalStxSpent = payments
    .filter(p => p.approved && p.asset_type === 'STX')
    .reduce((sum, p) => sum + p.amount, 0);
  const totalSbtcSpent = payments
    .filter(p => p.approved && p.asset_type === 'sBTC')
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="min-h-screen bg-background circuit-grid">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-mono text-4xl font-bold text-foreground mb-2 uppercase tracking-wider">{'> '}AUDIT LOG</h1>
              <p className="font-mono text-mutedForeground uppercase tracking-wide">COMPLETE PAYMENT HISTORY FOR COMPLIANCE AND TRACKING</p>
            </div>
            <button
              onClick={exportCSV}
              className="px-6 py-3 bg-accent border-2 border-accent text-background font-mono font-bold cyber-chamfer uppercase tracking-wider hover:brightness-110 transition-all shadow-neon"
            >
              {'> '}EXPORT CSV
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-card cyber-chamfer border-2 border-border p-6 shadow-neon-sm">
            <div className="text-sm font-mono font-bold text-accent mb-2 uppercase tracking-wider">TOTAL PAYMENTS</div>
            <div className="text-3xl font-bold font-mono text-foreground">{payments.length}</div>
          </div>

          <div className="bg-card cyber-chamfer border-2 border-border p-6 shadow-neon-sm">
            <div className="text-sm font-mono font-bold text-accent mb-2 uppercase tracking-wider">APPROVED</div>
            <div className="text-3xl font-bold font-mono text-accent">{totalApproved}</div>
          </div>

          <div className="bg-card cyber-chamfer border-2 border-border p-6 shadow-neon-sm">
            <div className="text-sm font-mono font-bold text-accent mb-2 uppercase tracking-wider">BLOCKED</div>
            <div className="text-3xl font-bold font-mono text-destructive">{totalBlocked}</div>
          </div>

          <div className="bg-card cyber-chamfer border-2 border-border p-6 shadow-neon-sm">
            <div className="text-sm font-mono font-bold text-accent mb-2 uppercase tracking-wider">TOTAL SPENT</div>
            <div className="text-lg font-bold font-mono text-foreground">
              {microSTXtoSTX(totalStxSpent).toFixed(6)} STX
            </div>
            <div className="text-sm font-mono text-mutedForeground">
              {satoshisToBTC(totalSbtcSpent).toFixed(8)} BTC
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card cyber-chamfer border-2 border-border p-6 mb-8">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-mono font-bold text-mutedForeground mb-2 uppercase tracking-wider">
                Status Filter
              </label>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as 'all' | 'approved' | 'blocked')}
                className="px-4 py-3 bg-background border-2 border-border font-mono text-foreground focus:border-accent focus:outline-none"
              >
                <option value="all">All Payments</option>
                <option value="approved">Approved Only</option>
                <option value="blocked">Blocked Only</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-mono font-bold text-mutedForeground mb-2 uppercase tracking-wider">
                Asset Filter
              </label>
              <select
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value as 'all' | 'STX' | 'sBTC')}
                className="px-4 py-3 bg-background border-2 border-border font-mono text-foreground focus:border-accent focus:outline-none"
              >
                <option value="all">All Assets</option>
                <option value="STX">STX Only</option>
                <option value="sBTC">sBTC Only</option>
              </select>
            </div>
          </div>
        </div>

        {/* Payments Table */}
        <div className="bg-card cyber-chamfer border-2 border-border overflow-hidden shadow-neon-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted border-b-2 border-border">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">
                    TIMESTAMP
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">
                    SERVICE
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">
                    AMOUNT
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">
                    STATUS
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">
                    TRANSACTION
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center font-mono text-mutedForeground uppercase tracking-wide">
                      NO PAYMENTS FOUND
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-foreground">
                        {format(new Date(payment.created_at), 'MMM d, yyyy HH:mm:ss')}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-foreground">
                        <div className="max-w-xs truncate" title={payment.service_url}>
                          {payment.service_url}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-foreground">
                        {payment.asset_type === 'STX' 
                          ? `${microSTXtoSTX(payment.amount).toFixed(6)} STX`
                          : `${satoshisToBTC(payment.amount).toFixed(8)} BTC`
                        }
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {payment.approved ? (
                          <span className="px-3 py-1 bg-accent/20 border border-accent text-accent text-xs font-mono font-semibold rounded-sm uppercase">
                            ✓ APPROVED
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-destructive/20 border border-destructive text-destructive text-xs font-mono font-semibold rounded-sm uppercase">
                            ✗ BLOCKED
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {payment.transaction_id ? (
                          <a
                            href={getExplorerTxUrl(payment.transaction_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-600 hover:text-orange-700 font-medium"
                          >
                            View →
                          </a>
                        ) : (
                          <span className="text-gray-400">N/A</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}