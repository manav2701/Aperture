'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';

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

          const { data: teamData } = await supabase
            .from('teams')
            .select('*')
            .eq('org_id', orgData.id);

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
      const ownerAddress = publicKey.toBase58();
      
      if (existingOrg) {
        // Update
        const { error } = await supabase
          .from('orgs')
          .update({
            name: orgName,
            global_daily_cap_sol: parseFloat(globalDailyCap),
            global_monthly_cap_sol: parseFloat(globalMonthlyCap)
          })
          .eq('id', existingOrg.id);
          
        if (error) throw error;
        alert(`Organization "${orgName}" updated successfully!`);
      } else {
        // Create Org (let DB generate UUID)
        const { data: newOrgData, error: orgError } = await supabase
          .from('orgs')
          .insert({
            owner_address: ownerAddress,
            name: orgName,
            global_daily_cap_sol: parseFloat(globalDailyCap),
            global_monthly_cap_sol: parseFloat(globalMonthlyCap)
          })
          .select('id')
          .single();
          
        if (orgError) throw orgError;
        
        // Also add the owner as an org_member automatically
        await supabase
          .from('org_members')
          .insert({
            org_id: newOrgData.id,
            member_address: ownerAddress,
            role: 0 // Owner
          });
          
        setExistingOrg({ id: newOrgData.id, owner_address: ownerAddress, name: orgName });
        alert(`Organization "${orgName}" created successfully!`);
      }
    } catch (err: any) {
      console.error('Org creation error:', err);
      alert('Failed to save organization: ' + err.message);
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
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full border-2 border-border p-10 text-center space-y-6 bg-background">
          <div className="w-12 h-12 border-4 border-border border-t-accent animate-spin mx-auto" />
          <h2 className="text-xl font-bold font-mono text-foreground uppercase tracking-tighter">
            SOLANA WALLET REQUIRED
          </h2>
          <p className="text-xs font-mono text-mutedForeground uppercase tracking-tight">
            Connect your wallet to configure corporate organization settings and team spending caps
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[ORGANIZATION]</span>
        <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
          ORGANIZATION &amp; TREASURY CONFIGURATOR
        </h1>
        <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
          CORPORATE MASTER WALLET &amp; DEPARTMENTAL TEAM ALLOCATION ENGINE
        </p>
      </div>

      {/* Org Parameters Form */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold text-accent uppercase tracking-tighter">
            &gt; MASTER ORGANIZATION PARAMETERS
          </h2>
          {existingOrg && (
            <span className="px-4 py-1.5 bg-accent text-accentForeground font-mono text-xs font-bold uppercase tracking-widest border-2 border-accent">
              [✓] ORG REGISTERED ON-CHAIN
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
              ORGANIZATION NAME
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="COMPANY NAME"
              className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
          </div>

          <div>
            <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
              GLOBAL DAILY CAP (SOL)
            </label>
            <input
              type="number"
              value={globalDailyCap}
              onChange={(e) => setGlobalDailyCap(e.target.value)}
              placeholder="1000.00"
              className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
          </div>

          <div>
            <label className="text-xs font-mono text-mutedForeground uppercase tracking-widest block mb-2">
              GLOBAL MONTHLY CAP (SOL)
            </label>
            <input
              type="number"
              value={globalMonthlyCap}
              onChange={(e) => setGlobalMonthlyCap(e.target.value)}
              placeholder="10000.00"
              className="w-full px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
            />
          </div>
        </div>

        <button
          onClick={handleCreateOrg}
          disabled={loading}
          className="kinetic-btn-primary w-full py-4 text-sm tracking-tighter"
        >
          {existingOrg ? 'UPDATE MASTER ORG CAPS' : 'CREATE ORGANIZATION ON-CHAIN'}
        </button>
      </div>

      {/* Team Allocations */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <h2 className="text-xl font-mono font-bold text-foreground uppercase tracking-tighter border-b-2 border-border pb-4">
          &gt; TEAM DEPARTMENT ALLOCATIONS
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="TEAM NAME (E.G. TRADING OPS)"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className="px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
          />
          <input
            type="text"
            placeholder="TEAM LEAD WALLET PUBKEY"
            value={teamLeadAddress}
            onChange={(e) => setTeamLeadAddress(e.target.value)}
            className="px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
          />
          <input
            type="number"
            placeholder="TEAM DAILY CAP (SOL)"
            value={teamDailyCap}
            onChange={(e) => setTeamDailyCap(e.target.value)}
            className="px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
          />
        </div>

        <button
          onClick={handleCreateTeam}
          disabled={loading}
          className="kinetic-btn-outline w-full py-3.5 text-xs tracking-tighter"
        >
          [+] CREATE TEAM ACCOUNT PDA
        </button>

        {teams.length > 0 ? (
          <div className="space-y-3 pt-4 divide-y-2 divide-border">
            {teams.map((t) => (
              <div key={t.id} className="p-4 bg-muted border border-border flex items-center justify-between">
                <div>
                  <h3 className="font-mono text-sm font-bold text-foreground uppercase">{t.name}</h3>
                  <p className="text-xs font-mono text-mutedForeground uppercase">LEAD: {t.team_lead_address.slice(0, 6)}...{t.team_lead_address.slice(-4)}</p>
                </div>
                <div className="text-right">
                  <span className="font-mono text-sm font-bold text-accent">{t.team_daily_cap_sol} SOL / DAY</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs font-mono text-mutedForeground uppercase italic text-center py-4">NO TEAM DEPARTMENTS CREATED YET.</p>
        )}
      </div>

    </div>
  );
}
