import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack for production builds
  // Use Webpack for stability
  turbopack: false,
  
  // Existing config...
  reactStrictMode: true,
  swcMinify: true,
  
  // Optimize bundle
  experimental: {
    optimizePackageImports: ['@stacks/transactions', '@stacks/network'],
  },
};

export default nextConfig;
