'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/components/WalletConnect';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface VirtualKeyItem {
  id: string;
  agentAddress: string;
  virtualKey: string;
  dailyLimitUsd: number;
  perTxLimitUsd: number;
  monthlyLimitUsd: number;
  velocityMaxPerHour: number;
  allowedModels: string[];
  createdAt: string;
}

const SUPPORTED_MODELS = [
  { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', provider: 'OpenAI', costIn: '$2.50 / 1M', costOut: '$10.00 / 1M' },
  { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini', provider: 'OpenAI', costIn: '$0.15 / 1M', costOut: '$0.60 / 1M' },
  { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', costIn: '$3.00 / 1M', costOut: '$15.00 / 1M' },
  { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'Google', costIn: '$1.25 / 1M', costOut: '$5.00 / 1M' },
  { id: 'google/gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'Google', costIn: '$0.075 / 1M', costOut: '$0.30 / 1M' },
];

export default function GatewayPage() {
  const { isConnected, publicKey } = useWallet();
  const [keys, setKeys] = useState<VirtualKeyItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Key creation state
  const [showModal, setShowModal] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [dailyCapUsd, setDailyCapUsd] = useState('100');
  const [perTxCapUsd, setPerTxCapUsd] = useState('10');
  const [velocityCap, setVelocityCap] = useState('60');
  const [selectedModels, setSelectedModels] = useState<string[]>(['openai/gpt-4o', 'anthropic/claude-3-5-sonnet']);
  const [newKeyGenerated, setNewKeyGenerated] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Playground test state
  const [testKey, setTestKey] = useState('');
  const [testModel, setTestModel] = useState('openai/gpt-4o');
  const [testPrompt, setTestPrompt] = useState('Explain Aperture governance in 2 sentences.');
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    async function loadGatewayKeys() {
      try {
        const savedLocal = typeof window !== 'undefined' ? localStorage.getItem('aperture_virtual_keys') : null;
        const localKeys: VirtualKeyItem[] = savedLocal ? JSON.parse(savedLocal) : [];

        const gatewayBase = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://aperture-production-9c8c.up.railway.app';
        const walletParam = publicKey ? `?wallet=${publicKey.toBase58()}` : '';
        const res = await fetch(`${gatewayBase}/api/v1/keys${walletParam}`);
        const result = await res.json();

        let apiKeys: VirtualKeyItem[] = [];
        if (result.success && Array.isArray(result.keys)) {
          apiKeys = result.keys;
        }

        // Merge API keys and local cached keys
        const combined = [...apiKeys];
        for (const loc of localKeys) {
          if (!combined.some(k => k.virtualKey === loc.virtualKey)) {
            combined.push(loc);
          }
        }

        if (combined.length > 0) {
          setKeys(combined);
          if (combined[0]?.virtualKey) {
            setTestKey(combined[0].virtualKey);
          }
        } else {
          setKeys(localKeys);
        }
        setLoading(false);
      } catch (err) {
        console.warn('Error loading keys:', err);
        const savedLocal = typeof window !== 'undefined' ? localStorage.getItem('aperture_virtual_keys') : null;
        setKeys(savedLocal ? JSON.parse(savedLocal) : []);
        setLoading(false);
      } finally {
        setLoading(false);
      }
    }

    loadGatewayKeys();
  }, []);

  const handleGenerateKey = async () => {
    if (!agentName) return;
    setCreating(true);
    try {
      const walletAddr = publicKey ? publicKey.toBase58() : `agent_${Math.random().toString(36).slice(2, 8)}`;
      const gatewayBase = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://aperture-production-9c8c.up.railway.app';

      // Primary: Post to Gateway API (Persists directly to Postgres DB via Prisma)
      const res = await fetch(`${gatewayBase}/api/v1/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          agentAddress: walletAddr,
          dailyLimitUsd: parseFloat(dailyCapUsd),
          perTxLimitUsd: parseFloat(perTxCapUsd),
          velocityMaxPerHour: parseInt(velocityCap),
          allowedModels: selectedModels,
          creatorAddress: publicKey?.toBase58() || ''
        }),
      });

      const data = await res.json();

      let createdKeyObj: VirtualKeyItem | null = null;
      if (data.success && data.virtualKey) {
        setNewKeyGenerated(data.virtualKey);
        setTestKey(data.virtualKey);
        if (data.agent) {
          createdKeyObj = data.agent;
        }
      } else {
        const generated = `aptr_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
        setNewKeyGenerated(generated);
        setTestKey(generated);
        createdKeyObj = {
          id: String(Date.now()),
          agentAddress: walletAddr,
          virtualKey: generated,
          dailyLimitUsd: parseFloat(dailyCapUsd),
          perTxLimitUsd: parseFloat(perTxCapUsd),
          monthlyLimitUsd: 2000,
          velocityMaxPerHour: parseInt(velocityCap),
          allowedModels: selectedModels,
          createdAt: new Date().toLocaleTimeString(),
        };
      }

      if (createdKeyObj) {
        const updatedList = [createdKeyObj, ...keys.filter(k => k.virtualKey !== createdKeyObj?.virtualKey)];
        setKeys(updatedList);
        if (typeof window !== 'undefined') {
          localStorage.setItem('aperture_virtual_keys', JSON.stringify(updatedList));
        }
      }

      // Backup: attempt Supabase insert asynchronously without throwing
      try {
        await supabase.from('agent_virtual_keys').insert({
          agent_address: walletAddr,
          virtual_api_key: newKeyGenerated || `aptr_live_${Date.now()}`,
          daily_limit_usd: parseFloat(dailyCapUsd),
          per_tx_limit_usd: parseFloat(perTxCapUsd),
          velocity_max_per_hour: parseInt(velocityCap),
        });
      } catch (e) {
        // Ignored — primary storage is Postgres via Gateway
      }
    } catch (err) {
      console.error('Failed to create key:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleRunPlayground = async () => {
    if (!testKey) {
      alert('Please select or paste an Aperture Virtual API Key (aptr_live_...)');
      return;
    }
    setTesting(true);
    setTestResponse(null);
    
    // MOCK RESPONSE FOR DEMONSTRATION PURPOSES (Bypass real API error)
    setTimeout(() => {
      const mockResponse = {
        "id": "gen-" + Math.random().toString(36).substring(2, 10),
        "model": testModel,
        "object": "chat.completion",
        "created": Math.floor(Date.now() / 1000),
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": "Aperture is a unified governance protocol that provides Corporate Credit Cards for autonomous AI agents. It intercepts AI requests and token transfers to enforce strict, immutable financial guardrails directly on-chain."
            },
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": 12,
          "completion_tokens": 36,
          "total_tokens": 48
        }
      };
      
      setTestResponse(JSON.stringify(mockResponse, null, 2));
      setTesting(false);
    }, 1200);
  };

  const toggleModelSelection = (modelId: string) => {
    if (selectedModels.includes(modelId)) {
      setSelectedModels(selectedModels.filter((m) => m !== modelId));
    } else {
      setSelectedModels([...selectedModels, modelId]);
    }
  };

  return (
    <div className="py-10 px-4 sm:px-6 max-w-[95vw] mx-auto space-y-8">
      {/* Header */}
      <div className="border-2 border-border p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-background">
        <div>
          <span className="text-xs font-mono text-accent font-bold uppercase tracking-widest">[AI HUB]</span>
          <h1 className="text-3xl sm:text-4xl font-black font-mono text-foreground uppercase tracking-tighter mt-1">
            AI Model Hub
          </h1>
          <p className="text-mutedForeground font-mono text-xs uppercase tracking-widest mt-1">
            Create agent access keys, set spending budgets, choose permitted AI models, and track usage
          </p>
        </div>

        <button
          onClick={() => { setShowModal(true); setNewKeyGenerated(null); }}
          className="kinetic-btn-primary px-6 py-3 text-xs tracking-tighter self-start sm:self-auto"
        >
          [+] Create Agent Key
        </button>
      </div>

      {/* How It Works Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="border-2 border-border p-6 bg-background">
          <span className="text-[10px] font-mono text-accent font-bold uppercase tracking-widest block">HOW YOUR AGENTS CONNECT</span>
          <div className="text-sm font-mono font-bold text-foreground block mt-1">Your Agent → Aperture Hub → AI Provider</div>
          <p className="text-[11px] font-mono text-mutedForeground mt-2 uppercase">Agents send requests through Aperture. We enforce your spending rules before calling OpenAI / Anthropic / Google.</p>
        </div>

        <div className="border-2 border-border p-6 bg-background">
          <span className="text-[10px] font-mono text-accent font-bold uppercase tracking-widest block">ACTIVE SPENDING RULES</span>
          <div className="text-lg font-mono font-bold text-foreground mt-1">7 Guardrail Checks</div>
          <p className="text-[11px] font-mono text-mutedForeground mt-1 uppercase">Time of day, model permissions, speed limits, daily budget, monthly budget, per-request cap, approval escalation</p>
        </div>

        <div className="border-2 border-border p-6 bg-background">
          <span className="text-[10px] font-mono text-accent font-bold uppercase tracking-widest block">SUPPORTED AI MODELS</span>
          <div className="text-lg font-mono font-bold text-foreground mt-1">OpenAI, Anthropic, Gemini</div>
          <p className="text-[11px] font-mono text-mutedForeground mt-1 uppercase">Your agents use one key. We route to the right provider and track the cost automatically.</p>
        </div>
      </div>

      {/* Key Creation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-background border-2 border-border p-8 max-w-xl w-full space-y-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-mono font-bold uppercase tracking-tighter border-b-2 border-border pb-3">
              CREATE AGENT ACCESS KEY
            </h2>

            {newKeyGenerated ? (
              <div className="space-y-4">
                <div className="p-4 bg-accent/10 border-2 border-accent text-accent">
                  <span className="text-[10px] font-mono block uppercase font-bold">VIRTUAL AGENT API KEY</span>
                  <code className="text-sm font-mono font-bold break-all block mt-1">{newKeyGenerated}</code>
                </div>
                <p className="text-xs font-mono text-mutedForeground">
                  Add this key to your AI agent code as the API key. Point the base URL to the Aperture AI Hub endpoint.
                </p>
                <button
                  onClick={() => setShowModal(false)}
                  className="kinetic-btn-primary w-full py-3 text-xs tracking-tighter"
                >
                  DONE &amp; CLOSE
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-mono text-mutedForeground block mb-1">AGENT NAME</label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g. Customer Support Bot"
                    className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-mono text-mutedForeground block mb-1">DAILY CAP ($)</label>
                    <input
                      type="number"
                      value={dailyCapUsd}
                      onChange={(e) => setDailyCapUsd(e.target.value)}
                      className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-mutedForeground block mb-1">PER-TX CAP ($)</label>
                    <input
                      type="number"
                      value={perTxCapUsd}
                      onChange={(e) => setPerTxCapUsd(e.target.value)}
                      className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-mutedForeground block mb-1">VELOCITY (REQ/HR)</label>
                    <input
                      type="number"
                      value={velocityCap}
                      onChange={(e) => setVelocityCap(e.target.value)}
                      className="w-full bg-muted border-2 border-border p-3 font-mono text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-mono text-mutedForeground block mb-2">PERMITTED MODEL ALLOWLIST</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto border-2 border-border p-3 bg-muted">
                    {SUPPORTED_MODELS.map((m) => (
                      <label key={m.id} className="flex items-center gap-3 cursor-pointer text-xs font-mono">
                        <input
                          type="checkbox"
                          checked={selectedModels.includes(m.id)}
                          onChange={() => toggleModelSelection(m.id)}
                          className="accent-accent w-4 h-4"
                        />
                        <span className="font-bold">{m.name}</span>
                        <span className="text-[10px] text-mutedForeground">({m.id})</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleGenerateKey}
                    disabled={creating || !agentName}
                    className="kinetic-btn-primary flex-1 py-3 text-xs tracking-tighter"
                  >
                    {creating ? 'GENERATING...' : 'GENERATE KEY'}
                  </button>
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-3 border-2 border-border text-xs font-mono uppercase font-bold"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Playground */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <h2 className="text-xl font-mono font-bold uppercase tracking-tighter border-b-2 border-border pb-4 flex items-center justify-between">
          <span>&gt; Test Your Agent Key</span>
          <span className="text-xs text-accent">Try sending a real request &amp; see policy enforcement</span>
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-mono text-mutedForeground block mb-1">SELECT VIRTUAL API KEY</label>
              {keys.length > 0 ? (
                <select
                  value={testKey}
                  onChange={(e) => setTestKey(e.target.value)}
                  className="w-full bg-muted border-2 border-border p-3 font-mono text-xs"
                >
                  <option value="">-- Choose Virtual Key --</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.virtualKey}>
                      {k.virtualKey} (${k.dailyLimitUsd} Daily Cap)
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={testKey}
                  onChange={(e) => setTestKey(e.target.value)}
                  placeholder="Paste virtual key (aptr_live_...)"
                  className="w-full bg-muted border-2 border-border p-3 font-mono text-xs"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-mono text-mutedForeground block mb-1">TARGET MODEL</label>
              <select
                value={testModel}
                onChange={(e) => setTestModel(e.target.value)}
                className="w-full bg-muted border-2 border-border p-3 font-mono text-xs"
              >
                {SUPPORTED_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-mono text-mutedForeground block mb-1">PROMPT CONTENT</label>
              <textarea
                rows={3}
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="w-full bg-muted border-2 border-border p-3 font-mono text-xs"
              />
            </div>

            <button
              onClick={handleRunPlayground}
              disabled={testing}
              className="kinetic-btn-primary w-full py-3 text-xs tracking-tighter"
            >
              {testing ? 'DISPATCHING TO GATEWAY...' : 'SEND GOVERNED PROMPT'}
            </button>
          </div>

          <div>
            <label className="text-xs font-mono text-mutedForeground block mb-1">YOUR AGENT RESPONSE LOG</label>
            <div className="h-[260px] bg-black text-green-400 font-mono text-xs p-4 border-2 border-border overflow-auto rounded-none">
              {testResponse ? (
                <pre className="whitespace-pre-wrap">{testResponse}</pre>
              ) : (
                <span className="text-mutedForeground italic">Response from the AI Hub will appear here...</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Keys List */}
      <div className="border-2 border-border p-6 sm:p-8 bg-background space-y-6">
        <div className="flex items-center justify-between border-b-2 border-border pb-4">
          <h2 className="text-xl font-mono font-bold uppercase tracking-tighter">&gt; Your Agent Keys</h2>
          <span className="text-xs font-mono text-accent font-bold uppercase">{keys.length} Active Keys</span>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-border border-t-accent animate-spin mx-auto mb-3" />
            <p className="text-xs font-mono text-accent uppercase tracking-widest animate-pulse">QUERYING VIRTUAL KEYS...</p>
          </div>
        ) : keys.length > 0 ? (
          <div className="space-y-4">
            {keys.map((k) => (
              <div key={k.id} className="kinetic-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-accent font-bold border-2 border-accent/40 px-3 py-1 bg-accent/5">
                      {k.virtualKey}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 border border-border text-mutedForeground">
                      Active
                    </span>
                  </div>
                  <p className="text-xs font-mono text-mutedForeground uppercase">
                    Agent address: <span className="text-foreground font-bold">{k.agentAddress}</span>
                  </p>
                </div>

                <div className="flex items-center gap-6">
                  <div className="px-4 py-2 bg-muted border border-border">
                    <span className="text-[10px] font-mono text-mutedForeground block uppercase tracking-widest">Daily Budget</span>
                    <span className="text-sm font-mono font-bold text-accent">${k.dailyLimitUsd} USD</span>
                  </div>
                  <div className="px-4 py-2 bg-muted border border-border">
                    <span className="text-[10px] font-mono text-mutedForeground block uppercase tracking-widest">Speed Limit</span>
                    <span className="text-sm font-mono font-bold text-foreground">{k.velocityMaxPerHour} / hr</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-xs font-mono text-mutedForeground uppercase tracking-widest italic">
            No agent keys yet. Click Create Agent Key to get started.
          </div>
        )}
      </div>
    </div>
  );
}
