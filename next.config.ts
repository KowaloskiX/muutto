import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disk caches use dynamic paths, so file tracing would otherwise pull local env files and
  // scratch folders into the serverless bundles.
  outputFileTracingExcludes: { "*": [".env*", ".vercel/**", "docs/**", "scripts/**", "data/**"] },
};

export default nextConfig;
