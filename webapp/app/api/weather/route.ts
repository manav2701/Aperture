import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const paymentHeader = request.headers.get('payment-signature');
  
  if (!paymentHeader) {
    return NextResponse.json(
      {
        error: 'Payment required',
        message: 'This API requires payment of 10,000 lamports (0.00001 SOL)',
        amount: 10000, // lamports
        asset: 'SOL',
        service: 'weather-api',
      },
      { 
        status: 402,
        headers: {
          'X-Payment-Required': 'true',
          'X-Payment-Amount': '10000',
          'X-Payment-Asset': 'SOL',
        }
      }
    );
  }

  const city = request.nextUrl.searchParams.get('city') || 'San Francisco';
  
  return NextResponse.json({
    success: true,
    data: {
      city,
      temperature: Math.floor(Math.random() * 30) + 10,
      conditions: ['Sunny', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 3)],
      humidity: Math.floor(Math.random() * 40) + 40,
      timestamp: new Date().toISOString(),
    },
    payment: {
      amount_lamports: 10000,
      asset: 'SOL',
      status: 'accepted',
    }
  });
}