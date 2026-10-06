import type { NextConfig } from "next";

const config: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  // Preserve the SDK's native ESM import of ws; bundling drops the CJS named server export.
  serverExternalPackages: ["pg", "ioredis", "ws", "@vercel/functions"],
  poweredByHeader: false,
  async rewrites() {
    return { beforeFiles: process.env.VERCEL ? [] : [{ source: "/api/ws", destination: `http://127.0.0.1:${process.env.SOCKET_PORT || 3001}/api/ws` }], afterFiles: [], fallback: [] };
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.audius.co" }, { protocol: "https", hostname: "**.audiuscdn.co" }],
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};
export default config;
