import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const paymentHeader = request.headers.get('payment-signature');
  
  if (!paymentHeader) {
    return NextResponse.json(
      {
        error: 'Payment required',
        message: 'This API requires payment of 0.0001 STX',
        amount: 100, // microSTX
        asset: 'STX',
      },
      { 
        status: 402,
        headers: {
          'X-Payment-Required': 'true',
          'X-Payment-Amount': '100',
          'X-Payment-Asset': 'STX',
        }
      }
    );
  }

  const body = await request.json();
  const { operation, value } = body;

  // Simulate expensive computation
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