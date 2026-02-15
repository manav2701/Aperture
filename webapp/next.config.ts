import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // Disable static page generation to avoid Turbopack SSR bugs
  output: undefined,
  
  // Empty turbopack config to acknowledge it exists
  turbopack: {},
  
  // Experimental options to work around Turbopack issues
  experimental: {
    // Disable worker threads that cause issues with Turbopack SSR
    workerThreads: false,
    cpus: 1,
  },
  
  // Webpack config for Node.js module fallbacks
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;