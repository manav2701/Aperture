import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const paymentHeader = request.headers.get('payment-signature');
  
  if (!paymentHeader) {
    return NextResponse.json(
      {
        error: 'Payment required',
        message: 'This API requires payment of 0.0001 SOL (100,000 lamports)',
        amount: 100000, // lamports
        asset: 'SOL',
      },
      { 
        status: 402,
        headers: {
          'X-Payment-Required': 'true',
          'X-Payment-Amount': '100000',
          'X-Payment-Asset': 'SOL',
        }
      }
    );
  }

  const body = await request.json();
  const { operation, value } = body;

  let result;
  if (operation === 'fibonacci') {
    result = fibonacci(value || 10);
  } else if (operation === 'prime') {
    result = isPrime(value || 17);
  } else {
    result = Math.random();
  }

  return NextResponse.json({
    success: true,
    data: {
      operation,
      input: value,
      result,
      timestamp: new Date().toISOString(),
    },
    aperture: {
      asset: 'SOL',
      amount_paid_lamports: 100000,
      policy_enforced: true,
    },
  });
}

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function isPrime(n: number): boolean {
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}