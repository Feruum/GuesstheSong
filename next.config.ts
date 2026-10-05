import type { NextConfig } from "next";

const config: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["pg", "ioredis", "ws"],
  poweredByHeader: false,
  async rewrites() {
    return { beforeFiles: [{ source: "/api/ws", destination: `http://127.0.0.1:${process.env.SOCKET_PORT || 3001}/api/ws` }], afterFiles: [], fallback: [] };
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
