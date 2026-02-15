import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  return handleProxyRequest(request, 'GET');
}

export async function POST(request: NextRequest) {
  return handleProxyRequest(request, 'POST');
}

async function handleProxyRequest(request: NextRequest, method: string) {
  try {
    console.log(' PROXY REQUEST RECEIVED', { method, url: request.url });
    const targetUrl = request.nextUrl.searchParams.get('target');
    const agentAddress = request.headers.get('x-agent-address');
    console.log(' Extracted:', { targetUrl, agentAddress });

    if (!targetUrl) {
      return NextResponse.json({ error: 'Missing target URL' }, { status: 400 });
    }
    if (!agentAddress) {
      return NextResponse.json({ error: 'Missing x-agent-address header' }, { status: 401 });
    }

   console.log(' Looking up policy for:', agentAddress);
    const { data: policy, error: policyError } = await supabase
      .from('policies')
      .select('*')
      .eq('agent_address', agentAddress)
      .single();

    console.log(' Policy result:', { policy, policyError });
    if (policyError || !policy) {
      console.log(' No policy found');
      await recordBlockedPayment(agentAddress, targetUrl, 0, 'No policy found');
      return NextResponse.json({
        error: 'No policy found for this agent',
        help: 'Create a policy at: http://localhost:3000/agents',
        agent_address: agentAddress,
        next_steps: [
          '1. Go to http://localhost:3000/agents',
          '2. Click "Create Agent" or use existing agent',
          '3. Use the agent address in your requests'
        ]
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

    const serviceOrigin = new URL(targetUrl).origin;
    console.log(' Checking service approval for:', serviceOrigin);
    const { data: serviceApproval } = await supabase
      .from('approved_services')
      .select('*')
      .eq('agent_address', agentAddress)
      .eq('service_url', serviceOrigin)
      .eq('approved', true)
      .single();

    if (!serviceApproval) {
      console.log(' Service not approved');
      await recordBlockedPayment(agentAddress, targetUrl, 0, 'Service not approved');
      return NextResponse.json({ error: `Service not approved: ${serviceOrigin}` }, { status: 403 });
    }

    console.log(' Forwarding request to:', targetUrl);
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

    console.log(' Target API response status:', targetResponse.status);

    if (targetResponse.status === 402) {
      const paymentInfo = await targetResponse.json();
      const amount = parseInt(paymentInfo.amount || '0');
      const policyCheck = await checkPolicyLimits(agentAddress, amount, policy);
      if (!policyCheck.allowed) {
        await recordBlockedPayment(agentAddress, targetUrl, amount, policyCheck.reason);
        return NextResponse.json({ error: 'Payment blocked', reason: policyCheck.reason }, { status: 403 });
      }
      await recordApprovedPayment(agentAddress, targetUrl, amount);
      return NextResponse.json(paymentInfo, { status: 402, headers: { 'X-Policy-Status': 'allowed' } });
    }

    if (targetResponse.ok) {
      const realPaymentAmount = targetResponse.headers.get('x-payment-amount');
      const paidAmount = realPaymentAmount ? parseInt(realPaymentAmount) : 1000;
      const paymentType = realPaymentAmount ? 'REAL x402' : 'DEMO SIMULATED';
      console.log('');
      console.log(` ${paymentType} PAYMENT RECORDED`);
      console.log('Amount:', paidAmount, 'microSTX (', (paidAmount / 1000000).toFixed(6), 'STX)');
      console.log('Service:', targetUrl);
      console.log('Agent:', agentAddress);
      console.log('');
      await recordApprovedPayment(agentAddress, targetUrl, paidAmount);
      console.log(' Payment logged to database!');
      console.log(' Check your dashboard!');
    }

    const responseData = await targetResponse.text();
    return new NextResponse(responseData, {
      status: targetResponse.status,
      headers: { 'Content-Type': targetResponse.headers.get('content-type') || 'application/json', 'X-Policy-Enforced': 'true' },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(' Proxy error:', errorMessage);
    return NextResponse.json({ error: 'Proxy error', details: errorMessage }, { status: 500 });
  }
}

interface Policy { daily_limit_stx: number; per_tx_limit_stx: number; [key: string]: unknown; }

async function checkPolicyLimits(agentAddress: string, amount: number, policy: Policy) {
  const today = new Date().toISOString().split('T')[0];
  const { data: spending } = await supabase.from('daily_spending').select('*').eq('agent_address', agentAddress).eq('day', today).single();
  const stxSpent = spending?.stx_spent || 0;
  const dailyLimit = policy.daily_limit_stx;
  const perTxLimit = policy.per_tx_limit_stx;
  if (amount > perTxLimit) return { allowed: false, reason: 'Amount exceeds per-transaction limit', remainingDaily: dailyLimit - stxSpent };
  if (stxSpent + amount > dailyLimit) return { allowed: false, reason: 'Would exceed daily limit', remainingDaily: dailyLimit - stxSpent };
  return { allowed: true, reason: 'Payment within limits', remainingDaily: dailyLimit - stxSpent - amount };
}

async function recordApprovedPayment(agentAddress: string, service: string, amount: number) {
  const today = new Date().toISOString().split('T')[0];
  console.log(' Recording approved payment:', { agentAddress, service, amount });
  const { data: paymentData, error: paymentError } = await supabase.from('payment_history').insert({ agent_address: agentAddress, amount, asset_type: 'STX', service_url: service, approved: true, transaction_id: `proxy-${Date.now()}` }).select();
  console.log(' Payment history result:', { paymentData, paymentError });
  if (paymentError) console.error(' Failed to insert payment:', paymentError);
  const { error: spendingError } = await supabase.rpc('increment_daily_spending', { p_agent_address: agentAddress, p_day: today, p_stx_amount: amount });
  if (spendingError) console.error(' Failed to update spending:', spendingError);
}

async function recordBlockedPayment(agentAddress: string, service: string, amount: number, reason: string) {
  console.log(' Recording blocked payment:', { agentAddress, service, amount, reason });
  await supabase.from('payment_history').insert({ agent_address: agentAddress, amount, asset_type: 'STX', service_url: service, approved: false, transaction_id: null });
}
