import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // Empty turbopack config is enough to silence the warning
  turbopack: {},
};

export default nextConfig;