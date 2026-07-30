import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const PRODUCTION_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://aperture-1.vercel.app';

export async function GET(request: NextRequest) {
  return handleProxyRequest(request, 'GET');
}

export async function POST(request: NextRequest) {
  return handleProxyRequest(request, 'POST');
}

async function handleProxyRequest(request: NextRequest, method: string) {
  try {
    const targetUrl = request.nextUrl.searchParams.get('target');
    const agentAddress = request.headers.get('x-agent-address');

    if (!targetUrl) {
      return NextResponse.json({ error: 'Missing target URL' }, { status: 400 });
    }
    if (!agentAddress) {
      return NextResponse.json({ error: 'Missing x-agent-address header' }, { status: 401 });
    }

    // Look up policy using real Supabase columns (SOL-based)
    const { data: policy, error: policyError } = await supabase
      .from('policies')
      .select('*')
      .eq('agent_address', agentAddress)
      .single();

    if (policyError || !policy) {
      await recordBlockedPayment(agentAddress, targetUrl, 0, 'No policy found');
      return NextResponse.json({
        error: 'No policy found for this agent',
        help: `Create a policy at: ${PRODUCTION_URL}/agents`,
        agent_address: agentAddress,
        next_steps: [
          `1. Go to ${PRODUCTION_URL}/agents`,
          '2. Click "Create Agent Policy"',
          '3. Use the agent address in your requests',
        ],
      }, { status: 403 });
    }

    if (policy.is_paused) {
      await recordBlockedPayment(agentAddress, targetUrl, 0, 'Agent is paused');
      return NextResponse.json({ error: 'Agent is paused' }, { status: 403 });
    }

    if (policy.is_revoked) {
      await recordBlockedPayment(agentAddress, targetUrl, 0, 'Agent is revoked');
      return NextResponse.json({ error: 'Agent access revoked' }, { status: 403 });
    }

    // Forward request to target API
    const headers: HeadersInit = {};
    request.headers.forEach((value, key) => {
      if (!key.startsWith('x-') && key !== 'host') {
        headers[key] = value;
      }
    });

    const targetResponse = await fetch(targetUrl, {
      method,
      headers,
      body: method === 'POST' ? await request.text() : undefined,
    });

    // Handle x402 Payment Required from target API
    if (targetResponse.status === 402) {
      const paymentInfo = await targetResponse.json();
      // Amount in lamports (SOL)
      const amount = parseInt(paymentInfo.amount || '0');
      const policyCheck = await checkPolicyLimits(agentAddress, amount, policy);

      if (!policyCheck.allowed) {
        await recordBlockedPayment(agentAddress, targetUrl, amount, policyCheck.reason);
        return NextResponse.json({
          error: 'Payment blocked by Aperture policy',
          reason: policyCheck.reason,
          remaining_daily_lamports: policyCheck.remainingDaily,
        }, { status: 403 });
      }

      await recordApprovedPayment(agentAddress, targetUrl, amount);
      return NextResponse.json(paymentInfo, {
        status: 402,
        headers: { 'X-Policy-Status': 'allowed', 'X-Policy-Enforced': 'true' },
      });
    }

    if (targetResponse.ok) {
      const realPaymentAmount = targetResponse.headers.get('x-payment-amount');
      const paidAmount = realPaymentAmount ? parseInt(realPaymentAmount) : 0;
      if (paidAmount > 0) {
        await recordApprovedPayment(agentAddress, targetUrl, paidAmount);
        console.log(`[Aperture] Payment recorded: ${paidAmount} lamports | Agent: ${agentAddress}`);
      }
    }

    const responseData = await targetResponse.text();
    return new NextResponse(responseData, {
      status: targetResponse.status,
      headers: {
        'Content-Type': targetResponse.headers.get('content-type') || 'application/json',
        'X-Policy-Enforced': 'true',
        'X-Aperture-Version': '3.0',
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Aperture] Proxy error:', errorMessage);
    return NextResponse.json({ error: 'Proxy error', details: errorMessage }, { status: 500 });
  }
}

interface PolicyRecord {
  daily_limit_sol?: number;
  per_tx_limit_sol?: number;
  [key: string]: unknown;
}

async function checkPolicyLimits(agentAddress: string, amountLamports: number, policy: PolicyRecord) {
  const dailyLimitLamports =
    (policy.daily_limit_sol as number) ||
    100_000_000_000; // 100 SOL default

  const perTxLimitLamports =
    (policy.per_tx_limit_sol as number) ||
    20_000_000_000; // 20 SOL default

  // Query today's payment_history for spend total
  const today = new Date().toISOString().split('T')[0];
  const { data: todaysPayments } = await supabase
    .from('payment_history')
    .select('amount')
    .eq('agent_address', agentAddress)
    .eq('approved', true)
    .gte('created_at', today + 'T00:00:00.000Z');

  const spentLamports = (todaysPayments || []).reduce(
    (sum: number, p: { amount: number }) => sum + (p.amount || 0),
    0
  );

  if (amountLamports > perTxLimitLamports) {
    return {
      allowed: false,
      reason: `Amount exceeds per-transaction limit (${(perTxLimitLamports / 1e9).toFixed(2)} SOL)`,
      remainingDaily: dailyLimitLamports - spentLamports,
    };
  }

  if (spentLamports + amountLamports > dailyLimitLamports) {
    return {
      allowed: false,
      reason: `Would exceed daily spending limit (${(dailyLimitLamports / 1e9).toFixed(2)} SOL)`,
      remainingDaily: dailyLimitLamports - spentLamports,
    };
  }

  return {
    allowed: true,
    reason: 'Payment within Aperture policy limits',
    remainingDaily: dailyLimitLamports - spentLamports - amountLamports,
  };
}

async function recordApprovedPayment(agentAddress: string, service: string, amount: number) {
  const { error } = await supabase.from('payment_history').insert({
    agent_address: agentAddress,
    amount,
    asset_type: 'SOL',
    service_url: service,
    approved: true,
    transaction_id: `proxy-${Date.now()}`,
    created_at: new Date().toISOString(),
  });
  if (error) console.error('[Aperture] Failed to log approved payment:', error.message);
}

async function recordBlockedPayment(agentAddress: string, service: string, amount: number, reason: string) {
  const { error } = await supabase.from('payment_history').insert({
    agent_address: agentAddress,
    amount,
    asset_type: 'SOL',
    service_url: service,
    approved: false,
    transaction_id: null,
    created_at: new Date().toISOString(),
  });
  if (error) console.error('[Aperture] Failed to log blocked payment:', error.message);
}
