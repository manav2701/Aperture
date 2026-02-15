import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // Add empty turbopack config to silence the warning
  turbopack: {
    resolveAlias: {
      // Add fallbacks for Node.js modules that aren't available in the browser
      fs: false,
      net: false,
      tls: false,
    },
  },
  
  // Keep webpack config for backwards compatibility when using --webpack flag
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
