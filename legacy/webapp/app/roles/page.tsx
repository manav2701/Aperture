'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface MemberRoleItem {
  id: string;
  wallet: string;
  role: string;
  roleLevel: number;
}

export default function RolesPage() {
  const { isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(true);
  const [memberWallet, setMemberWallet] = useState('');
  const [selectedRole, setSelectedRole] = useState('1');
  const [members, setMembers] = useState<MemberRoleItem[]>([]);

  const roleNames: { [key: number]: string } = {
    0: 'OWNER (MASTER AUTHORITY)',
    1: 'CFO (TREASURY & CAPS ADMIN)',
    2: 'TEAMLEAD (DEPARTMENT LEAD)',
    3: 'DEVELOPER (AGENT INTEGRATOR)',
    4: 'AUDITOR (READ-ONLY COMPLIANCE)',
  };

  const [activeOrg, setActiveOrg] = useState<any>(null);

  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }

    async function loadMembers() {
      if (!publicKey) return;
      try {
        const addr = publicKey.toBase58();
        
        // 1. Find which org this user belongs to
        const { data: myMembership } = await supabase
          .from('org_members')
          .select('org_id')
          .eq('member_address', addr)
          .single();
          
        let orgId = myMembership?.org_id;
        
        if (!orgId) {
          // Check if they are an owner of an org but not in org_members for some reason
          const { data: orgData } = await supabase.from('orgs').select('id').eq('owner_address', addr).single();
          if (orgData) orgId = orgData.id;
        }

        if (orgId) {
          setActiveOrg(orgId);
          const { data } = await supabase.from('org_members').select('*').eq('org_id', orgId);
          
          if (data && data.length > 0) {
            setMembers(
              data.map((m: any) => ({
                id: m.id,
                wallet: m.member_address,
                role: roleNames[m.role] || 'MEMBER',
                roleLevel: m.role,
              }))
            );
            return;
          }
        }
        
        // Fallback if no org
        setMembers([{ id: 'owner-1', wallet: addr, role: 'OWNER (MASTER AUTHORITY)', roleLevel: 0 }]);
      } catch (err) {
        console.warn('Error loading members:', err);
      } finally {
        setLoading(false);
      }
    }

    loadMembers();
  }, [publicKey]);

  const handleAddMember = async () => {
    if (!isConnected || !publicKey) {
      alert('Please connect your Solana wallet first');
      return;
    }
    if (!memberWallet) {
      alert('Please enter Member Wallet Address');
      return;
    }
    if (!activeOrg) {
      alert('No organization found. Please go to ORGANIZATION and create one first.');
      return;
    }

    setLoading(true);
    try {
      const roleLevel = parseInt(selectedRole);
      
      const { error } = await supabase.from('org_members').insert({
        org_id: activeOrg,
        member_address: memberWallet,
        role: roleLevel
      });
      
      if (error) throw error;
      
      setMembers([
        ...members,
        {
          id: String(Date.now()),
          wallet: memberWallet,
          role: roleNames[roleLevel],
          roleLevel,
        },
      ]);
      alert(`Member ${memberWallet.slice(0, 6)}... added with role: ${roleNames[roleLevel]}`);
      setMemberWallet('');
    } catch (err: any) {
      console.error('Member error:', err);
      alert('Failed to add member: ' + err.message);
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
            Connect your wallet to configure organization member roles &amp; RBAC matrix
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background">
        <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[RBAC]</span>
        <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
          ROLE-BASED ACCESS CONTROL
        </h1>
        <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
          MEMBER ROLES, OPERATIONAL PERMISSIONS, AND POLICY MODIFICATION RIGHTS
        </p>
      </div>

      {/* Role Assignment Form */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <h2 className="text-xl font-mono font-bold text-accent uppercase tracking-tighter border-b-2 border-border pb-4">
          &gt; ASSIGN MEMBER ROLE
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="MEMBER WALLET PUBKEY"
            value={memberWallet}
            onChange={(e) => setMemberWallet(e.target.value)}
            className="md:col-span-2 px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground placeholder:text-mutedForeground focus:outline-none focus:border-accent uppercase"
          />

          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="px-4 py-3 bg-muted border-2 border-border text-xs font-mono text-foreground focus:outline-none focus:border-accent uppercase font-bold"
          >
            <option value="1">CFO (TREASURY ADMIN)</option>
            <option value="2">TEAMLEAD (DEPARTMENT LEAD)</option>
            <option value="3">DEVELOPER (AGENT INTEGRATOR)</option>
            <option value="4">AUDITOR (READ-ONLY)</option>
          </select>
        </div>

        <button
          onClick={handleAddMember}
          disabled={loading}
          className="kinetic-btn-primary w-full py-4 text-sm tracking-tighter"
        >
          ASSIGN MEMBER ROLE ON-CHAIN
        </button>
      </div>

      {/* Roster */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold text-foreground uppercase tracking-tighter">
            &gt; MEMBER ROSTER MATRIX
          </h2>
          <span className="text-xs font-mono text-accent font-bold uppercase">{members.length} MEMBERS REGISTERED</span>
        </div>

        <div className="divide-y-2 divide-border">
          {members.map((m) => (
            <div key={m.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="font-mono text-sm font-bold text-foreground block uppercase">{m.wallet}</span>
                <span className="text-xs font-mono text-accent font-bold uppercase">{m.role}</span>
              </div>

              <div className="px-3 py-1.5 bg-muted border border-border text-xs font-mono font-bold text-mutedForeground uppercase">
                LEVEL: {m.roleLevel}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
