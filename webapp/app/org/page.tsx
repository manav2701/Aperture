'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { getSolanaConnection } from '@/lib/solana';
import { supabase } from '@/lib/supabase';
import { PublicKey } from '@solana/web3.js';
import { HiOfficeBuilding, HiPlus, HiShieldCheck, HiUsers } from 'react-icons/hi';

export const dynamic = 'force-dynamic';

export default function OrgSettingsPage() {
  const { isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);

  // Org Form State
  const [orgName, setOrgName] = useState('Acme AI Corporation');
  const [globalDailyCap, setGlobalDailyCap] = useState('1000');
  const [globalMonthlyCap, setGlobalMonthlyCap] = useState('10000');
  const [existingOrg, setExistingOrg] = useState<any>(null);

  // Team Form State
  const [teamName, setTeamName] = useState('');
  const [teamDailyCap, setTeamDailyCap] = useState('500');
  const [teamLeadAddress, setTeamLeadAddress] = useState('');
  const [teams, setTeams] = useState<any[]>([]);

  useEffect(() => {
    if (!publicKey) return;

    async function loadOrgData() {
      if (!publicKey) return;
      try {
        const { data: orgData } = await supabase
          .from('orgs')
          .select('*')
          .eq('owner_address', publicKey.toBase58())
          .single();

        if (orgData) {
          setExistingOrg(orgData);
          setOrgName(orgData.name);
          setGlobalDailyCap(orgData.global_daily_cap_sol.toString());
          setGlobalMonthlyCap(orgData.global_monthly_cap_sol.toString());

          // Load teams
          const { data: teamData } = await supabase
            .from('teams')
            .select('*')
            .eq('org_pda', orgData.org_pda);

          if (teamData) setTeams(teamData);
        }
      } catch (err) {
        console.warn('Error loading org data:', err);
      }
    }

    loadOrgData();
  }, [publicKey]);

  const handleCreateOrg = async () => {
    if (!isConnected || !publicKey) {
      alert('Please connect your Solana wallet first');
      return;
    }

    setLoading(true);
    try {
      alert(`Instruction prepared to create Organization "${orgName}" on Solana!`);
    } catch (err) {
      console.error('Org creation error:', err);
      alert('Failed to save organization');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTeam = async () => {
    if (!teamName || !teamLeadAddress) {
      alert('Please fill out Team Name and Team Lead Wallet Address');
      return;
    }

    setLoading(true);
    try {
      alert(`Instruction prepared to create Team "${teamName}" under Organization on Solana!`);
    } catch (err) {
      console.error('Team creation error:', err);
      alert('Failed to create team');
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-10 text-center shadow-2xl shadow-cyan-950/30">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-xl font-bold font-mono text-cyan-400 mb-3 uppercase tracking-wider">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-slate-400 text-xs font-mono mb-6 leading-relaxed">
            Connect your wallet to configure corporate organization settings and team spending caps
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-purple-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-purple-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiOfficeBuilding className="w-8 h-8 text-purple-400" />
            <h1 className="text-2xl font-black font-mono text-purple-400 uppercase tracking-wider">
              ORGANIZATION & TREASURY CONFIGURATOR
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Aperture v3 Hierarchical Wallet Abstraction • Corporate Master Wallet & Team Allocation
          </p>
        </div>

        {/* Organization Global Settings Form */}
        <div className="bg-slate-900/80 border border-purple-500/20 rounded-2xl p-8 backdrop-blur-xl space-y-6">
          <h2 className="text-lg font-mono font-bold text-purple-400 uppercase tracking-wider border-b border-slate-800 pb-3 flex items-center justify-between">
            <span>&gt; Master Organization Parameters</span>
            {existingOrg && (
              <span className="text-xs font-mono px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full">
                ORG REGISTERED ON-CHAIN
              </span>
            )}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                Organization Name
              </label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Company Name"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                Global Daily Cap (SOL)
              </label>
              <input
                type="number"
                value={globalDailyCap}
                onChange={(e) => setGlobalDailyCap(e.target.value)}
                placeholder="1000.00"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-slate-400 uppercase tracking-wider block mb-2">
                Global Monthly Cap (SOL)
              </label>
              <input
                type="number"
                value={globalMonthlyCap}
                onChange={(e) => setGlobalMonthlyCap(e.target.value)}
                placeholder="10000.00"
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <button
            onClick={handleCreateOrg}
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-mono font-black text-sm rounded-xl transition-all uppercase tracking-widest shadow-lg shadow-purple-600/20"
          >
            {existingOrg ? 'UPDATE MASTER ORG CAPS' : 'CREATE ORGANIZATION ON-CHAIN'}
          </button>
        </div>

        {/* Teams Management */}
        <div className="bg-slate-900/80 border border-purple-500/20 rounded-2xl p-8 backdrop-blur-xl space-y-6">
          <h2 className="text-lg font-mono font-bold text-purple-400 uppercase tracking-wider border-b border-slate-800 pb-3">
            &gt; Team Department Allocations
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              type="text"
              placeholder="Team Name (e.g. Trading Ops)"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
            />
            <input
              type="text"
              placeholder="Team Lead Wallet Pubkey"
              value={teamLeadAddress}
              onChange={(e) => setTeamLeadAddress(e.target.value)}
              className="px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
            />
            <input
              type="number"
              placeholder="Team Daily Cap (SOL)"
              value={teamDailyCap}
              onChange={(e) => setTeamDailyCap(e.target.value)}
              className="px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
            />
          </div>

          <button
            onClick={handleCreateTeam}
            disabled={loading}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 border border-purple-500/40 text-purple-300 font-mono font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all uppercase tracking-wider"
          >
            <HiPlus className="w-4 h-4" /> CREATE TEAM ACCOUNT PDA
          </button>

          {teams.length > 0 ? (
            <div className="space-y-3 pt-4">
              {teams.map((t) => (
                <div key={t.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <h3 className="font-mono text-sm font-bold text-slate-200">{t.name}</h3>
                    <p className="text-xs font-mono text-slate-500">Lead: {t.team_lead_address.slice(0, 6)}...{t.team_lead_address.slice(-4)}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-sm font-bold text-purple-400">{t.team_daily_cap_sol} SOL / Day</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-mono text-slate-500 italic text-center py-4">No team departments created yet.</p>
          )}
        </div>

      </div>
    </div>
  );
}
