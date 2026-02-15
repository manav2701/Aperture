'use client';

import { useState } from 'react';
import { useWallet } from './WalletConnect';
import { supabase } from '@/lib/supabase';

export default function EmergencyControls() {
  const { address } = useWallet();
  const [loading, setLoading] = useState(false);

  const handlePause = async () => {
    if (!address || !confirm('Pause your agent? All payments will be blocked immediately.')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('policies')
        .update({ is_paused: true })
        .eq('agent_address', address);

      if (error) throw error;

      alert('Agent paused successfully!');
      window.location.reload();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to pause agent');
    } finally {
      setLoading(false);
    }
  };

  const handleUnpause = async () => {
    if (!address) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('policies')
        .update({ is_paused: false })
        .eq('agent_address', address);

      if (error) throw error;

      alert('Agent unpaused!');
      window.location.reload();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to unpause agent');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!address || !confirm('PERMANENTLY REVOKE agent access? This CANNOT be undone!')) return;
    if (!confirm('Are you ABSOLUTELY SURE? This is permanent!')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('policies')
        .update({ is_revoked: true, is_active: false })
        .eq('agent_address', address);

      if (error) throw error;

      alert('Agent permanently revoked!');
      window.location.reload();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to revoke agent');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card cyber-chamfer border-2 border-destructive p-8 shadow-[0_0_20px_rgba(255,51,102,0.3)]">
      <h2 className="font-mono text-2xl font-bold text-destructive mb-6 uppercase tracking-wider">{'> '}EMERGENCY CONTROLS</h2>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-destructive/10 border-2 border-destructive cyber-chamfer-sm">
          <div>
            <h3 className="font-mono font-semibold text-foreground uppercase tracking-wider">PAUSE AGENT</h3>
            <p className="text-sm font-mono text-mutedForeground uppercase tracking-wide">TEMPORARILY DISABLE ALL PAYMENTS</p>
          </div>
          <button
            onClick={handlePause}
            disabled={loading}
            className="px-6 py-2 bg-white border-2 border-white text-black font-mono font-bold cyber-chamfer-sm hover:brightness-90 disabled:opacity-50 transition-all uppercase tracking-wider shadow-[0_0_10px_rgba(255,255,255,0.5)]"
          >
            PAUSE
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-accent/10 border-2 border-accent cyber-chamfer-sm">
          <div>
            <h3 className="font-mono font-semibold text-foreground uppercase tracking-wider">UNPAUSE AGENT</h3>
            <p className="text-sm font-mono text-mutedForeground uppercase tracking-wide">RESUME PAYMENTS</p>
          </div>
          <button
            onClick={handleUnpause}
            disabled={loading}
            className="px-6 py-2 bg-white border-2 border-white text-black font-mono font-bold cyber-chamfer-sm hover:brightness-90 disabled:opacity-50 transition-all uppercase tracking-wider shadow-[0_0_10px_rgba(255,255,255,0.5)]"
          >
            UNPAUSE
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-destructive/20 border-2 border-destructive cyber-chamfer-sm">
          <div>
            <h3 className="font-mono font-semibold text-destructive uppercase tracking-wider">REVOKE AGENT (PERMANENT)</h3>
            <p className="text-sm font-mono text-mutedForeground uppercase tracking-wide">PERMANENTLY DISABLE - CANNOT BE UNDONE!</p>
          </div>
          <button
            onClick={handleRevoke}
            disabled={loading}
            className="px-6 py-2 bg-white border-2 border-white text-black font-mono font-bold cyber-chamfer-sm hover:brightness-90 disabled:opacity-50 transition-all uppercase tracking-wider shadow-[0_0_15px_rgba(255,255,255,0.6)]"
          >
            REVOKE
          </button>
        </div>
      </div>
    </div>
  );
}