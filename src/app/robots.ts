import type { MetadataRoute } from "next";

const base = process.env.NEXTAUTH_URL || "http://localhost:3000";

// Everything below redirects an unauthenticated visitor straight to /login
// (or, for /login itself, has no indexable content) — keeping crawlers off
// them points crawl budget at the pages that actually carry content:
// / (marketing), /explore + /explore/[slug] (category hubs), /card/[id].
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/login",
        "/onboarding",
        "/profile",
        "/notifications",
        "/map",
        "/upgrade",
        "/invite/",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
