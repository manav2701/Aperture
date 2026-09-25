import type { NextConfig } from 'next';

// Static security headers. The Content-Security-Policy needs a per-request nonce, so it is set in
// proxy.ts instead.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

// Where the control-plane API listens. The browser only ever talks to this app's origin; /api/*
// is proxied, so auth cookies are first-party and there is no CORS surface.
// Rewrites are fixed at build time, so a Vercel build without it would ship a broken proxy.
if (process.env.VERCEL === '1' && process.env.API_INTERNAL_URL === undefined) {
  throw new Error('Set API_INTERNAL_URL (the API origin, e.g. https://aperture-fz76.onrender.com) and redeploy.');
}
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@aperture/core'],
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
  rewrites() {
    return Promise.resolve([{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]);
  },
};

export default nextConfig;
