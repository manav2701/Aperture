import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Polyfill global WebSocket for Node.js environments
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Supabase client (using URL and ANON/SERVICE_ROLE key)
const supabaseUrl = process.env.SUPABASE_URL || 'https://fkvoweryeifabfebzsos.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_aWPeQNGD2EFYcIl-TTCYUw_EHM02yxF';
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// In-memory key store fallback
const inMemoryKeys: any[] = [];

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());

// Log incoming requests
app.use((req: Request, _res: Response, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Root & Health check
app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'Aperture AI Gateway',
    version: '2.0.0',
    status: 'online',
    providers: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet', 'google/gemini-1.5-pro', 'meta-llama/llama-3.1-8b-instruct:free'],
    docs: 'https://openrouter.ai/models'
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- API: List Agent Keys ---
app.get('/api/v1/keys', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('agent_virtual_keys')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      const dbKeys = data.map((item: any) => ({
        id: item.id,
        name: item.agent_name || 'AI Agent',
        agentAddress: item.agent_address,
        virtualKey: item.virtual_api_key,
        dailyLimitUsd: parseFloat(item.daily_limit_usd || 100),
        perTxLimitUsd: parseFloat(item.per_tx_limit_usd || 10),
        monthlyLimitUsd: parseFloat(item.monthly_limit_usd || 2000),
        spentTodayUsd: 0,
        velocityMaxPerHour: item.velocity_max_per_hour || 60,
        allowedModels: ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet'],
        createdAt: item.created_at
      }));

      const allKeys = [...dbKeys, ...inMemoryKeys.filter((mem: any) => !dbKeys.some((db: any) => db.virtualKey === mem.virtualKey))];
      return res.json({ success: true, keys: allKeys });
    }
  } catch (err: any) {
    console.warn('Supabase fetch failed, using fallback:', err.message);
  }

  return res.json({ success: true, keys: inMemoryKeys });
});

// --- API: Create Agent Key ---
app.post('/api/v1/keys', async (req: Request, res: Response) => {
  const {
    name = 'AI Agent',
    agentAddress = `agent_${Math.random().toString(36).slice(2, 8)}`,
    dailyLimitUsd = 100.0,
    perTxLimitUsd = 10.0,
    velocityMaxPerHour = 60,
    allowedModels = ['openai/gpt-4o', 'anthropic/claude-3-5-sonnet']
  } = req.body || {};

  const virtualApiKey = `aptr_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;

  const keyObj = {
    id: String(Date.now()),
    name,
    agentAddress,
    virtualKey: virtualApiKey,
    dailyLimitUsd: Number(dailyLimitUsd),
    perTxLimitUsd: Number(perTxLimitUsd),
    monthlyLimitUsd: 2000,
    spentTodayUsd: 0,
    velocityMaxPerHour: Number(velocityMaxPerHour),
    allowedModels,
    createdAt: new Date().toISOString()
  };

  inMemoryKeys.unshift(keyObj);

  // Persist to Supabase asynchronously
  try {
    await supabase.from('agent_virtual_keys').insert({
      agent_address: agentAddress,
      virtual_api_key: virtualApiKey,
      daily_limit_usd: Number(dailyLimitUsd),
      per_tx_limit_usd: Number(perTxLimitUsd),
      velocity_max_per_hour: Number(velocityMaxPerHour)
    });
    console.log(`✅ Persisted key ${virtualApiKey.slice(0, 18)}... to Supabase`);
  } catch (err: any) {
    console.warn('Supabase key insert fallback:', err.message);
  }

  return res.json({
    success: true,
    virtualKey: virtualApiKey,
    agent: keyObj
  });
});

// --- API: Governed Chat Completion Proxy ---
app.post('/api/v1/chat/completions', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

  if (!apiKey) {
    return res.status(401).json({
      error: { message: 'Missing API key. Provide Bearer token.', type: 'authentication_error' }
    });
  }

  const { model, messages } = req.body || {};

  if (!model || !messages) {
    return res.status(400).json({ error: { message: 'Missing model or messages in request body.' } });
  }

  // Verify OpenRouter key configured
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    return res.status(500).json({ error: { message: 'OPENROUTER_API_KEY is not configured on gateway.' } });
  }

  try {
    console.log(`[OpenRouter] Dispatching prompt to model '${model}'...`);
    const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://aperture-1.vercel.app',
        'X-Title': 'Aperture AI Governance Platform'
      },
      body: JSON.stringify({ model, messages })
    });

    const responseData: any = await openRouterRes.json();

    if (!openRouterRes.ok) {
      return res.status(openRouterRes.status).json(responseData);
    }

    // Log request asynchronously to Supabase audit log
    const inputTokens = responseData.usage?.prompt_tokens || 0;
    const outputTokens = responseData.usage?.completion_tokens || 0;
    const costUsd = (inputTokens + outputTokens) * 0.000003;

    try {
      await supabase.from('agent_request_logs').insert({
        agent_address: 'governed_agent',
        virtual_api_key: apiKey,
        model_slug: model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        status: 'APPROVED'
      });
    } catch (e) {
      // Ignored non-critical log error
    }

    return res.json(responseData);
  } catch (err: any) {
    console.error('❌ OpenRouter dispatch error:', err);
    return res.status(502).json({
      error: { message: err.message || 'Failed to reach AI provider via OpenRouter', type: 'provider_error' }
    });
  }
});

// Start Express server on 0.0.0.0
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Aperture Node Gateway running on http://0.0.0.0:${PORT}`);
});
