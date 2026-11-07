import Script from "next/script";

/** Umami page-view analytics. Absent website ID = no script injected, and
 * skipped outside production (same guard as AdsenseScript) so dev traffic
 * never pollutes the stats.
 *
 * next/script is fine here, unlike AdSense: nothing needs to find this tag in
 * the raw server HTML. Umami's tracker hooks history.pushState itself, so
 * App Router client-side navigations are counted without extra wiring.
 *
 * NEXT_PUBLIC_UMAMI_SCRIPT_URL defaults to Umami Cloud; point it at
 * <your-umami-host>/script.js for a self-hosted instance. */
export function UmamiScript() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (process.env.NODE_ENV !== "production" || !websiteId) return null;

  const src =
    process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || "https://cloud.umami.is/script.js";

  return <Script src={src} data-website-id={websiteId} strategy="afterInteractive" />;
}
