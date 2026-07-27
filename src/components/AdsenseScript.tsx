/** Absent client ID = no script injected. Also skipped outside production —
 * mirrors ServiceWorkerRegistrar's guard, since AdSense won't serve real
 * creatives on a dev server anyway.
 *
 * A plain native <script> tag, not next/script: AdSense's site-verification
 * check fetches the raw page HTML looking for this exact tag, and
 * next/script never renders one — at every strategy (including
 * beforeInteractive) it emits a preload link plus an inline bootstrap script
 * that only materializes the real <script src> tag once the browser runs
 * it. A native tag renders as literal server HTML with no JS required. */
export function AdsenseScript() {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  if (process.env.NODE_ENV !== "production" || !clientId) return null;

  return (
    <script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
      crossOrigin="anonymous"
    />
  );
}
