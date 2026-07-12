import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // TEMPORARY while testing the deploy: tell every cache (Cloudflare
        // included) not to store responses, so stale pages can't mask fixes.
        // Remove once the deploy is stable. Note: Next.js still forces
        // long-lived caching for content-hashed /_next/static assets, which
        // is safe — their URLs change on every build.
        source: "/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
