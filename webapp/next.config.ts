import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // Optimize package imports for better bundling
  experimental: {
    optimizePackageImports: [
      '@stacks/transactions',
      '@stacks/network',
      '@stacks/connect',
    ],
  },
};

export default nextConfig;
