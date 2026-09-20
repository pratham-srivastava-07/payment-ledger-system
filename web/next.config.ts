import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:3000";
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      { source: "/api-docs/:path*", destination: `${apiOrigin}/api-docs/:path*` },
    ];
  },
};

export default nextConfig;
