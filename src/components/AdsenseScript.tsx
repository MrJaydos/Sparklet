import Script from "next/script";

/** Absent client ID = no script injected. Also skipped outside production —
 * mirrors ServiceWorkerRegistrar's guard, since AdSense won't serve real
 * creatives on a dev server anyway. */
export function AdsenseScript() {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  if (process.env.NODE_ENV !== "production" || !clientId) return null;

  return (
    <Script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  );
}
