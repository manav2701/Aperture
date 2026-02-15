'use client';

import React, { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';
import { STXtoMicroSTX, BTCtoSatoshis, generateAgentWallet } from '@/lib/stacks';
import { HiFire, HiRefresh, HiLockClosed, HiClipboardCopy, HiSearch, HiTrash, HiExclamationCircle } from 'react-icons/hi';

interface Agent {
  id: string;
  agent_name: string;
  agent_address: string;
  agent_mnemonic?: string;
  daily_limit_stx: number;
  per_tx_limit_stx: number;
  is_paused: boolean;
}

interface NewAgentResult {
  address: string;
  mnemonic: string;
}

export default function AgentsPage() {
  const { address, isConnected } = useWallet();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAgentResult, setNewAgentResult] = useState<NewAgentResult | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // Form state
  const [agentName, setAgentName] = useState('');
  const [dailyLimitStx, setDailyLimitStx] = useState('10');
  const [perTxLimitStx, setPerTxLimitStx] = useState('1');

  useEffect(() => {
    if (address) loadAgents();
  }, [address]);

  async function loadAgents() {
    const { data } = await supabase
      .from('policies')
      .select('*')
      .eq('owner_address', address)
      .order('created_at', { ascending: false });

    if (data) {
      setAgents(data.map((p: any) => ({
        id: p.id,
        agent_name: p.agent_name,
        agent_address: p.agent_address, // ✅ Fix: Include agent address
        agent_mnemonic: p.agent_mnemonic,
        daily_limit_stx: p.daily_limit_stx,
        per_tx_limit_stx: p.per_tx_limit_stx,
        is_paused: p.is_paused,
      })));
    }
  }

  async function createAgent() {
    if (!address) return;

    setLoading(true);
    try {
      // 🔥 GENERATE REAL STACKS WALLET
      console.log('🔐 Generating real Stacks wallet for agent...');
      const wallet = generateAgentWallet();
      console.log('✅ Wallet generated:', wallet.address);

      const policyData = {
        agent_name: agentName || 'Unnamed Agent',
        agent_address: wallet.address,
        agent_mnemonic: wallet.mnemonic, // Store for recovery
        owner_address: address,
        daily_limit_stx: STXtoMicroSTX(parseFloat(dailyLimitStx)),
        daily_limit_sbtc: 100000000, // Default 1 sBTC
        per_tx_limit_stx: STXtoMicroSTX(parseFloat(perTxLimitStx)),
        per_tx_limit_sbtc: 10000000, // Default 0.1 sBTC
        is_active: true,
        is_paused: false,
        is_revoked: false,
      };

      const { error } = await supabase.from('policies').insert(policyData);

      if (error) throw error;

      // 🆕 AUTO-APPROVE COMMON SERVICES
      const commonServices = [
        'https://wttr.in',
        'https://httpbin.org',
        'https://jsonplaceholder.typicode.com'
      ];

      for (const service of commonServices) {
        await supabase.from('approved_services').insert({
          agent_address: wallet.address,
          service_url: service,
          approved: true,
        });
      }

      // Show result with mnemonic
      setNewAgentResult({
        address: wallet.address,
        mnemonic: wallet.mnemonic,
      });
      
      setShowCreateForm(false);
      setAgentName('');
      loadAgents();
    } catch (error) {
      console.error('Error creating agent:', error);
      alert('Failed to create agent: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function generateDemoAgents() {
    if (!address || !confirm('Generate 5 REAL agent wallets with different limits?\n\nThis will take ~10 seconds.')) return;

    setLoading(true);
    try {
      const demoAgents = [
        { name: 'Senior Dev', dailyLimit: 10, perTxLimit: 5 },
        { name: 'Mid Dev', dailyLimit: 5, perTxLimit: 2 },
        { name: 'Junior Dev', dailyLimit: 2, perTxLimit: 0.5 },
        { name: 'Contractor', dailyLimit: 1, perTxLimit: 0.3 },
        { name: 'Intern', dailyLimit: 0.5, perTxLimit: 0.1 },
      ];

      const commonServices = [
        'https://wttr.in',
        'https://httpbin.org',
        'https://jsonplaceholder.typicode.com'
      ];

      console.log('🔐 Generating 5 real Stacks wallets...');
      
      for (const agent of demoAgents) {
        // Generate REAL wallet
        const wallet = generateAgentWallet();
        console.log(`✅ Generated ${agent.name}:`, wallet.address);

        await supabase.from('policies').insert({
          agent_name: agent.name,
          agent_address: wallet.address,
          agent_mnemonic: wallet.mnemonic,
          owner_address: address,
          daily_limit_stx: STXtoMicroSTX(agent.dailyLimit),
          daily_limit_sbtc: 100000000,
          per_tx_limit_stx: STXtoMicroSTX(agent.perTxLimit),
          per_tx_limit_sbtc: 10000000,
          is_active: true,
          is_paused: false,
          is_revoked: false,
        });

        // 🆕 AUTO-APPROVE SERVICES FOR EACH AGENT
        for (const service of commonServices) {
          await supabase.from('approved_services').insert({
            agent_address: wallet.address,
            service_url: service,
            approved: true,
          });
        }
      }

      alert('✅ 5 REAL agent wallets created!\n\nEach has a valid Stacks address.\nView mnemonics in the table below (click "Show Mnemonic").');
      loadAgents();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to generate demo agents: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    alert(`${label} copied to clipboard!`);
  }

  async function pauseAgent(agentAddress: string) {
    await supabase.from('policies').update({ is_paused: true }).eq('agent_address', agentAddress);
    loadAgents();
  }

  async function unpauseAgent(agentAddress: string) {
    await supabase.from('policies').update({ is_paused: false }).eq('agent_address', agentAddress);
    loadAgents();
  }

  async function deleteAgent(agent: Agent) {
    // 🔒 OWNER PROTECTION - Cannot delete your main wallet
    const OWNER_WALLET = 'ST28DERT007J1P63JPP4XGDKW0BWEXFHCJ0RVNT38';
    if (agent.agent_address === OWNER_WALLET) {
      alert('🚫 Cannot delete owner wallet!');
      return;
    }

    // 🛡️ FIRST CONFIRMATION
    const confirmed = confirm(
      `⚠️ DELETE AGENT\n\n` +
      `Address: ${agent.agent_address}\n\n` +
      `This will permanently delete:\n` +
      `• Agent wallet access\n` +
      `• All payment history\n` +
      `• Daily spending records\n` +
      `• Approved services list\n\n` +
      `Are you sure you want to continue?`
    );

    if (!confirmed) return;

    // 🛡️ SECOND CONFIRMATION - Type DELETE to confirm
    const confirmText = prompt(
      `🔐 FINAL CONFIRMATION\n\n` +
      `You are about to permanently delete:\n` +
      `${agent.agent_address}\n\n` +
      `⚠️ WARNING: If this agent has a mnemonic, you will lose access to the wallet forever unless you have backed it up!\n\n` +
      `Type DELETE (in uppercase) to confirm:`
    );

    if (confirmText !== 'DELETE') {
      alert('❌ Deletion cancelled - confirmation text did not match.');
      return;
    }

    setLoading(true);
    try {
      // 🗑️ CASCADE DELETE from all tables
      const agentAddress = agent.agent_address;

      // Delete payment history
      await supabase
        .from('payment_history')
        .delete()
        .eq('agent_address', agentAddress);

      // Delete daily spending
      await supabase
        .from('daily_spending')
        .delete()
        .eq('agent_address', agentAddress);

      // Delete approved services
      await supabase
        .from('approved_services')
        .delete()
        .eq('agent_address', agentAddress);

      // Delete approved facilitators
      await supabase
        .from('approved_facilitators')
        .delete()
        .eq('agent_address', agentAddress);

      // Delete sessions
      await supabase
        .from('sessions')
        .delete()
        .eq('agent_address', agentAddress);

      // Finally, delete the policy (agent)
      const { error } = await supabase
        .from('policies')
        .delete()
        .eq('agent_address', agentAddress);

      if (error) throw error;

      alert(`✅ Agent ${agentAddress} deleted successfully!`);
      loadAgents();
    } catch (error) {
      console.error('Delete error:', error);
      alert('❌ Failed to delete agent: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="font-mono text-mutedForeground uppercase tracking-wider">{'> '}CONNECT YOUR WALLET TO MANAGE AGENTS</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background circuit-grid p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="font-mono text-3xl font-bold text-foreground uppercase tracking-wider">
              {'> '}MANAGE AGENTS
            </h1>
            <p className="font-mono text-mutedForeground mt-2">CREATE REAL STACKS WALLETS FOR YOUR AI AGENTS</p>
            <p className="text-sm text-accent mt-1 font-mono uppercase tracking-wider">REAL ADDRESSES • BLOCKCHAIN VERIFIABLE • PRODUCTION-READY</p>
          </div>
          <div className="space-x-4">
            <button
              onClick={generateDemoAgents}
              disabled={loading}
              className="px-4 py-2 bg-accentSecondary border-2 border-accentSecondary text-white font-mono uppercase tracking-wider cyber-chamfer-sm hover:brightness-110 disabled:opacity-50 transition-all shadow-neon-secondary flex items-center gap-2"
            >
              {loading ? (
                <>
                  <HiRefresh className="w-4 h-4 animate-spin" />
                  GENERATING...
                </>
              ) : (
                <>
                  <HiFire className="w-4 h-4" />
                  GENERATE 5 REAL AGENTS
                </>
              )}
            </button>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="px-6 py-2 bg-accent border-2 border-accent text-background font-mono uppercase tracking-wider cyber-chamfer-sm hover:brightness-110 transition-all shadow-neon"
            >
              {'> '}CREATE AGENT
            </button>
          </div>
        </div>

        {/* Success Modal - Show after agent creation */}
        {newAgentResult && (
          <div className="fixed inset-0 bg-background/95 flex items-center justify-center z-50 p-4">
            <div className="bg-card cyber-chamfer border-2 border-accent shadow-neon max-w-2xl w-full p-6">
              <h2 className="font-mono text-2xl font-bold mb-4 text-accent uppercase tracking-wider">AGENT WALLET CREATED!</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Agent Address (use in API calls)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newAgentResult.address}
                      readOnly
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md font-mono text-sm bg-gray-50"
                    />
                    <button
                      onClick={() => copyToClipboard(newAgentResult.address, 'Address')}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Copy
                    </button>
                    <a
                      href={`https://explorer.hiro.so/address/${newAgentResult.address}?chain=testnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                    >
                      View on Explorer
                    </a>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
                    <HiLockClosed className="w-4 h-4" />
                    Recovery Phrase (24 words) - SAVE THIS!
                  </label>
                  <div className="bg-yellow-50 border border-yellow-300 rounded-md p-4 mb-2">
                    <p className="text-sm text-yellow-800 mb-2">
                      ⚠️ <strong>Security Warning:</strong> This is the ONLY way to recover this wallet. Store it securely offline!
                    </p>
                    <textarea
                      value={newAgentResult.mnemonic}
                      readOnly
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs bg-white"
                    />
                  </div>
                  <button
                    onClick={() => copyToClipboard(newAgentResult.mnemonic, 'Mnemonic')}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                  >
                    Copy Recovery Phrase
                  </button>
                </div>

                <div className="bg-blue-50 border border-blue-300 rounded-md p-4">
                  <h3 className="font-bold text-blue-900 mb-2">📝 Next Steps:</h3>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
                    <li>Copy the agent address above</li>
                    <li>Use it in your n8n workflow as <code className="bg-blue-100 px-1 rounded">x-agent-address</code> header</li>
                    <li>Optional: Fund this wallet with STX to enable real payments</li>
                    <li>View activity on Stacks Explorer</li>
                  </ol>
                </div>
              </div>

              <button
                onClick={() => setNewAgentResult(null)}
                className="mt-6 w-full px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Done - Close
              </button>
            </div>
          </div>
        )}

        {showCreateForm && (
          <div className="bg-card cyber-chamfer border-2 border-border p-6 mb-8 shadow-neon-sm">
            <h2 className="font-mono text-xl font-bold mb-4 text-foreground uppercase tracking-wider">{'> '}CREATE NEW AGENT</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Agent Name (optional)
                </label>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g., Senior AI Agent"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Daily Limit (STX)
                </label>
                <input
                  type="number"
                  value={dailyLimitStx}
                  onChange={(e) => setDailyLimitStx(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Per-Transaction Limit (STX)
                </label>
                <input
                  type="number"
                  value={perTxLimitStx}
                  onChange={(e) => setPerTxLimitStx(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
            </div>
            <div className="flex space-x-4">
              <button
                onClick={createAgent}
                disabled={loading}
                className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Agent'}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="bg-card cyber-chamfer border-2 border-border overflow-hidden shadow-neon-sm">
          <table className="w-full">
            <thead className="bg-muted border-b-2 border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">AGENT ADDRESS</th>
                <th className="px-6 py-3 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">DAILY LIMIT</th>
                <th className="px-6 py-3 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">PER-TX LIMIT</th>
                <th className="px-6 py-3 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">STATUS</th>
                <th className="px-6 py-3 text-left text-xs font-mono font-bold text-accent uppercase tracking-wider">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {agents.map((agent) => (
                <React.Fragment key={agent.id}>
                  <tr className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-mono text-foreground">{agent.agent_address}</div>
                        <button
                          onClick={() => copyToClipboard(agent.agent_address, 'Address')}
                          className="text-accent hover:text-accentTertiary transition-colors"
                          title="Copy address"
                        >
                          <HiClipboardCopy className="w-4 h-4" />
                        </button>
                        <a
                          href={`https://explorer.hiro.so/address/${agent.agent_address}?chain=testnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accentTertiary hover:text-accent transition-colors"
                          title="View on blockchain explorer"
                        >
                          <HiSearch className="w-4 h-4" />
                        </a>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm text-foreground">{(agent.daily_limit_stx / 1000000).toFixed(2)} STX</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm text-foreground">{(agent.per_tx_limit_stx / 1000000).toFixed(3)} STX</div>
                    </td>
                    <td className="px-6 py-4">
                      {agent.is_paused ? (
                        <span className="px-2 py-1 text-xs font-mono rounded-sm bg-destructive/20 text-destructive border border-destructive uppercase">PAUSED</span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-mono rounded-sm bg-accent/20 text-accent border border-accent uppercase">ACTIVE</span>
                      )}
                    </td>
                    <td className="px-6 py-4 space-x-2">
                      {agent.is_paused ? (
                        <button
                          onClick={() => unpauseAgent(agent.agent_address)}
                          className="text-green-600 hover:text-green-800 text-sm"
                        >
                          Unpause
                        </button>
                      ) : (
                        <button
                          onClick={() => pauseAgent(agent.agent_address)}
                          className="text-yellow-600 hover:text-yellow-800 text-sm"
                        >
                          Pause
                        </button>
                      )}
                      {agent.agent_mnemonic && (
                        <button
                          onClick={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          {expandedAgent === agent.id ? '🔼 Hide' : '🔽 Show Mnemonic'}
                        </button>
                      )}
                      {agent.agent_address === 'ST28DERT007J1P63JPP4XGDKW0BWEXFHCJ0RVNT38' ? (
                        <button
                          disabled
                          className="text-gray-400 text-sm cursor-not-allowed"
                          title="Cannot delete owner wallet"
                        >
                          🔒 Owner
                        </button>
                      ) : (
                        <button
                          onClick={() => deleteAgent(agent)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium flex items-center gap-1"
                          title="Delete agent permanently"
                        >
                          <HiTrash className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedAgent === agent.id && agent.agent_mnemonic && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-yellow-50">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                              <HiLockClosed className="w-4 h-4" />
                              Recovery Phrase (24 words)
                            </label>
                            <button
                              onClick={() => copyToClipboard(agent.agent_mnemonic!, 'Mnemonic')}
                              className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                            >
                              Copy Mnemonic
                            </button>
                          </div>
                          <textarea
                            value={agent.agent_mnemonic}
                            readOnly
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs bg-white"
                          />
                          <p className="text-xs text-red-600 flex items-center gap-1">
                            <HiExclamationCircle className="w-4 h-4" />
                            Keep this private! Anyone with this phrase can access the wallet.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {agents.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p>No agents yet. Create your first agent!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}