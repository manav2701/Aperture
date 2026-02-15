import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Simulate x402 payment requirement
  const paymentHeader = request.headers.get('payment-signature');
  
  if (!paymentHeader) {
    // Return 402 Payment Required
    return NextResponse.json(
      {
        error: 'Payment required',
        message: 'This API requires payment of 0.00001 STX',
        amount: 10, // microSTX
        asset: 'STX',
        service: 'weather-api',
      },
      { 
        status: 402,
        headers: {
          'X-Payment-Required': 'true',
          'X-Payment-Amount': '10',
          'X-Payment-Asset': 'STX',
        }
      }
    );
  }

  // Payment accepted - return weather data
  const city = request.nextUrl.searchParams.get('city') || 'San Francisco';
  
  return NextResponse.json({
    success: true,
    data: {
      city: city,
      temperature: Math.floor(Math.random() * 30) + 10,
      conditions: ['Sunny', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 3)],
      humidity: Math.floor(Math.random() * 40) + 40,
      timestamp: new Date().toISOString(),
    },
    payment: {
      amount: 10,
      asset: 'STX',
      status: 'accepted',
    }
  });
}