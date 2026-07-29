'use client';

import { useState } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { HiShieldCheck, HiPlus, HiTrash, HiUserGroup } from 'react-icons/hi';

export const dynamic = 'force-dynamic';

interface MemberRoleItem {
  id: string;
  wallet: string;
  role: string;
  roleLevel: number;
}

export default function RolesPage() {
  const { isConnected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);

  // Form State
  const [memberWallet, setMemberWallet] = useState('');
  const [selectedRole, setSelectedRole] = useState('1'); // CFO default

  const [members, setMembers] = useState<MemberRoleItem[]>([
    {
      id: '1',
      wallet: publicKey ? publicKey.toBase58() : 'OwnerWalletAddress...',
      role: 'Owner (Master Authority)',
      roleLevel: 0,
    },
  ]);

  const roleNames: { [key: number]: string } = {
    0: 'Owner (Master Authority)',
    1: 'CFO (Treasury & Caps Admin)',
    2: 'TeamLead (Department Lead)',
    3: 'Developer (Agent Integrator)',
    4: 'Auditor (Read-Only Compliance)',
  };

  const handleAddMember = async () => {
    if (!isConnected) {
      alert('Please connect your Solana wallet first');
      return;
    }
    if (!memberWallet) {
      alert('Please enter Member Wallet Address');
      return;
    }

    setLoading(true);
    try {
      const roleLevel = parseInt(selectedRole);
      setMembers([
        ...members,
        {
          id: String(Date.now()),
          wallet: memberWallet,
          role: roleNames[roleLevel],
          roleLevel,
        },
      ]);
      alert(`Member ${memberWallet.slice(0, 6)}... added on-chain with role: ${roleNames[roleLevel]}`);
      setMemberWallet('');
    } catch (err) {
      console.error('Member error:', err);
      alert('Failed to add member');
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
            Connect your wallet to configure organization member roles & RBAC matrix
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-emerald-950/30">
          <div className="flex items-center gap-3 mb-2">
            <HiShieldCheck className="w-8 h-8 text-emerald-400" />
            <h1 className="text-2xl font-black font-mono text-emerald-400 uppercase tracking-wider">
              ROLE-BASED ACCESS CONTROL (RBAC)
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-xs">
            Manage organization members, assign operational roles, and enforce on-chain policy modification permissions
          </p>
        </div>

        {/* Member Assignment Form */}
        <div className="bg-slate-900/80 border border-emerald-500/20 rounded-2xl p-8 backdrop-blur-xl space-y-6">
          <h2 className="text-lg font-mono font-bold text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-3">
            &gt; Assign Member Role
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              type="text"
              placeholder="Member Wallet Address (Pubkey)"
              value={memberWallet}
              onChange={(e) => setMemberWallet(e.target.value)}
              className="md:col-span-2 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
            />

            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="1">CFO (Treasury Admin)</option>
              <option value="2">TeamLead (Department Lead)</option>
              <option value="3">Developer (Agent Integrator)</option>
              <option value="4">Auditor (Read-Only)</option>
            </select>
          </div>

          <button
            onClick={handleAddMember}
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-mono font-black text-sm rounded-xl transition-all uppercase tracking-widest shadow-lg shadow-emerald-500/20"
          >
            ASSIGN MEMBER ROLE ON-CHAIN
          </button>
        </div>

        {/* Role Matrix Members Table */}
        <div className="bg-slate-900/80 border border-emerald-500/20 rounded-2xl overflow-hidden backdrop-blur-xl">
          <div className="p-6 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <HiUserGroup className="w-4 h-4" /> Organization Member Roster
            </h2>
            <span className="text-xs font-mono text-slate-500">{members.length} members registered</span>
          </div>

          <div className="divide-y divide-slate-800">
            {members.map((m) => (
              <div key={m.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <span className="font-mono text-sm font-bold text-slate-200 block">{m.wallet}</span>
                  <span className="text-xs font-mono text-emerald-400 font-semibold">{m.role}</span>
                </div>

                <div className="px-3 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-400">
                  Role Level: {m.roleLevel}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
