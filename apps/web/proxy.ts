import { NextResponse, type NextRequest } from 'next/server';

/**
 * A fresh nonce per request, so only scripts Next.js renders can run (plan/security). Pages are
 * rendered dynamically for this reason; see the root layout.
 */
/** The storage origin (MEDIA_ORIGIN, e.g. https://<project>.storage.supabase.co), validated. */
function mediaOrigin(): string {
  const value = process.env.MEDIA_ORIGIN;
  if (value === undefined || value === '') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? ` ${url.origin}` : '';
  } catch {
    return '';
  }
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  // Generated images and videos are served from private storage by signed URL.
  const media = mediaOrigin();
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' blob: data:${media}`,
    `media-src 'self'${media}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
