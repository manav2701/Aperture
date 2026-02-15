'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import { STXtoMicroSTX, microSTXtoSTX, BTCtoSatoshis, satoshisToBTC } from '@/lib/stacks';
import { HiLink, HiFlag, HiCheckCircle } from 'react-icons/hi';

export default function PoliciesPage() {
  const { address, isConnected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [policy, setPolicy] = useState<any>(null);
  const [services, setServices] = useState<string[]>([]);
  const [facilitators, setFacilitators] = useState<string[]>([]);

  // Form state
  const [dailyLimitStx, setDailyLimitStx] = useState('10');
  const [dailyLimitSbtc, setDailyLimitSbtc] = useState('1');
  const [perTxLimitStx, setPerTxLimitStx] = useState('1');
  const [perTxLimitSbtc, setPerTxLimitSbtc] = useState('0.1');
  const [newService, setNewService] = useState('');
  const [newFacilitator, setNewFacilitator] = useState('');

  // Load existing policy
  useEffect(() => {
    if (!address) return;

    async function loadPolicy() {
      const { data } = await supabase
        .from('policies')
        .select('*')
        .eq('agent_address', address)
        .single();

      if (data) {
        setPolicy(data);
        setDailyLimitStx(microSTXtoSTX(data.daily_limit_stx).toString());
        setDailyLimitSbtc(satoshisToBTC(data.daily_limit_sbtc).toString());
        setPerTxLimitStx(microSTXtoSTX(data.per_tx_limit_stx).toString());
        setPerTxLimitSbtc(satoshisToBTC(data.per_tx_limit_sbtc).toString());
      }

      // Load approved services
      const { data: servicesData } = await supabase
        .from('approved_services')
        .select('service_url')
        .eq('agent_address', address)
        .eq('approved', true);

      if (servicesData) {
        setServices(servicesData.map(s => s.service_url));
      }

      // Load approved facilitators
      const { data: facilitatorsData } = await supabase
        .from('approved_facilitators')
        .select('facilitator_address')
        .eq('agent_address', address)
        .eq('approved', true);

      if (facilitatorsData) {
        setFacilitators(facilitatorsData.map(f => f.facilitator_address));
      }
    }

    loadPolicy();
  }, [address]);

  const handleCreatePolicy = async () => {
    if (!address) return;

    setLoading(true);
    try {
      const policyData = {
        agent_address: address,
        owner_address: address,
        daily_limit_stx: STXtoMicroSTX(parseFloat(dailyLimitStx)),
        daily_limit_sbtc: BTCtoSatoshis(parseFloat(dailyLimitSbtc)),
        per_tx_limit_stx: STXtoMicroSTX(parseFloat(perTxLimitStx)),
        per_tx_limit_sbtc: BTCtoSatoshis(parseFloat(perTxLimitSbtc)),
        is_active: true,
        is_paused: false,
        is_revoked: false,
      };

      const { error } = await supabase
        .from('policies')
        .upsert(policyData, { onConflict: 'agent_address' });

      if (error) throw error;

      alert('Policy created/updated successfully!');
      window.location.reload();
    } catch (error) {
      console.error('Error creating policy:', error);
      alert('Failed to create policy');
    } finally {
      setLoading(false);
    }
  };

  const handleAddService = async () => {
    if (!address || !newService) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('approved_services').insert({
        agent_address: address,
        service_url: newService,
        approved: true,
      });

      if (error) throw error;

      setServices([...services, newService]);
      setNewService('');
      alert('Service approved!');
    } catch (error) {
      console.error('Error approving service:', error);
      alert('Failed to approve service');
    } finally {
      setLoading(false);
    }
  };

  const handleAddFacilitator = async () => {
    if (!address || !newFacilitator) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('approved_facilitators').insert({
        agent_address: address,
        facilitator_address: newFacilitator,
        approved: true,
      });

      if (error) throw error;

      setFacilitators([...facilitators, newFacilitator]);
      setNewFacilitator('');
      alert('Facilitator approved!');
    } catch (error) {
      console.error('Error approving facilitator:', error);
      alert('Failed to approve facilitator');
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="font-mono text-2xl font-bold text-foreground mb-4 uppercase tracking-wider">{'> '}CONNECT WALLET</h2>
          <p className="font-mono text-mutedForeground uppercase tracking-wide">PLEASE CONNECT YOUR WALLET TO MANAGE POLICIES</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background circuit-grid">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <div className="mb-8">
          <h1 className="font-mono text-4xl font-bold text-foreground mb-2 uppercase tracking-wider">{'> '}POLICY MANAGEMENT</h1>
          <p className="font-mono text-mutedForeground uppercase tracking-wide">SET SPENDING LIMITS AND APPROVED SERVICES</p>
        </div>

        {/* Create/Update Policy Form */}
        <div className="bg-card cyber-chamfer border-2 border-border p-8 mb-8 shadow-neon-sm">
          <h2 className="font-mono text-2xl font-bold text-foreground mb-6 uppercase tracking-wider">
            {policy ? '{'>'} UPDATE POLICY' : '{'>'} CREATE POLICY'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Daily Limit STX */}
            <div>
              <label className="block text-sm font-mono font-bold text-accent mb-2 uppercase tracking-wider">
                DAILY LIMIT (STX)
              </label>
              <input
                type="number"
                value={dailyLimitStx}
                onChange={(e) => setDailyLimitStx(e.target.value)}
                className="w-full px-4 py-2 bg-muted border-2 border-border cyber-chamfer-sm font-mono text-foreground focus:border-accent focus:shadow-neon-sm transition-all"
                placeholder="10"
                step="0.000001"
              />
            </div>

            {/* Daily Limit sBTC */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Daily Limit (sBTC)
              </label>
              <input
                type="number"
                value={dailyLimitSbtc}
                onChange={(e) => setDailyLimitSbtc(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="1"
                step="0.00000001"
              />
            </div>

            {/* Per-Tx Limit STX */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Per-Transaction Limit (STX)
              </label>
              <input
                type="number"
                value={perTxLimitStx}
                onChange={(e) => setPerTxLimitStx(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="1"
                step="0.000001"
              />
            </div>

            {/* Per-Tx Limit sBTC */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Per-Transaction Limit (sBTC)
              </label>
              <input
                type="number"
                value={perTxLimitSbtc}
                onChange={(e) => setPerTxLimitSbtc(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="0.1"
                step="0.00000001"
              />
            </div>
          </div>

          <button
            onClick={handleCreatePolicy}
            disabled={loading}
            className="mt-6 w-full px-6 py-3 bg-accent border-2 border-accent text-background font-mono font-bold cyber-chamfer uppercase tracking-wider hover:brightness-110 disabled:opacity-50 transition-all shadow-neon"
          >
            {loading ? 'CREATING POLICY...' : policy ? 'UPDATE POLICY' : 'CREATE POLICY'}
          </button>
        </div>

        {/* Policy Proxy URL */}
        <div className="bg-accent/10 border-2 border-accent cyber-chamfer p-8 mb-8 shadow-neon">
          <h2 className="font-mono text-2xl font-bold mb-4 text-accent uppercase tracking-wider flex items-center gap-2">
            <HiLink className="w-6 h-6" />
            YOUR POLICY PROXY URL
          </h2>
          <p className="font-mono mb-4 text-foreground uppercase tracking-wide">
            USE THIS URL IN ANY AGENT (N8N, LANGCHAIN, AUTOGPT) TO ENFORCE YOUR POLICIES:
          </p>
          <div className="bg-background/50 cyber-chamfer-sm border border-border p-4 font-mono text-sm break-all text-accent">
            {typeof window !== 'undefined' && `${window.location.origin}/api/proxy?target=YOUR_TARGET_URL`}
          </div>
          <div className="mt-4 space-y-2 text-sm font-mono">
            <p className="text-mutedForeground flex items-center gap-2">
              <HiFlag className="w-4 h-4" />
              ADD HEADER: <code className="bg-background/30 px-2 py-1 cyber-chamfer-sm border border-border text-accent">x-agent-address: {address}</code>
            </p>
          </div>
        </div>

        {/* Approved Services */}
        <div className="bg-card cyber-chamfer border-2 border-border p-8 mb-8 shadow-neon-sm">
          <h2 className="font-mono text-2xl font-bold text-foreground mb-6 uppercase tracking-wider">{'> '}APPROVED SERVICES</h2>

          <div className="flex gap-4 mb-6">
            <input
              type="text"
              value={newService}
              onChange={(e) => setNewService(e.target.value)}
              placeholder="https://api.example.com"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
            <button
              onClick={handleAddService}
              className="px-6 py-2 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 transition-colors"
            >
              Add Service
            </button>
          </div>

          <div className="space-y-2">
            {services.map((service, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-background border border-border">
                <span className="text-sm font-mono text-foreground">{service}</span>
                <div className="flex items-center gap-2">
                  <HiCheckCircle className="w-5 h-5 text-accentSecondary" />
                  <span className="font-mono text-xs text-accentSecondary uppercase font-bold">Approved</span>
                </div>
              </div>
            ))}
            {services.length === 0 && (
              <p className="text-center text-gray-500 py-8">No approved services yet</p>
            )}
          </div>
        </div>

        {/* Approved Facilitators */}
        <div className="bg-card cyber-chamfer border-2 border-border p-6">
          <h2 className="font-mono text-xl font-bold text-foreground uppercase tracking-wider mb-6">{'> '}Approved Facilitators</h2>

          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={newFacilitator}
              onChange={(e) => setNewFacilitator(e.target.value)}
              placeholder="SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"
              className="flex-1 px-4 py-3 bg-background border-2 border-border font-mono text-foreground placeholder:text-mutedForeground focus:border-accent focus:outline-none"
            />
            <button
              onClick={handleAddFacilitator}
              className="px-6 py-3 bg-accentSecondary border-2 border-accentSecondary text-background font-mono font-bold uppercase tracking-wide hover:brightness-110 transition-all"
            >
              Add Facilitator
            </button>
          </div>

          <div className="space-y-3">
            {facilitators.map((facilitator, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-background border border-border">
                <span className="text-sm font-mono text-foreground">{facilitator}</span>
                <div className="flex items-center gap-2">
                  <HiCheckCircle className="w-5 h-5 text-accentSecondary" />
                  <span className="font-mono text-xs text-accentSecondary uppercase font-bold">Approved</span>
                </div>
              </div>
            ))}
            {facilitators.length === 0 && (
              <p className="font-mono text-mutedForeground text-sm py-8 text-center">No approved facilitators yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}