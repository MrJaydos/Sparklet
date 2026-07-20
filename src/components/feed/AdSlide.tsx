"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** A full-height feed slide, same shape as the "invite" slide — an honest
 * "Sponsored" frame around the ad unit rather than disguising it as content.
 * Renders nothing (never mounted at all for premium users — see Feed.tsx)
 * when AdSense env vars are absent. */
export function AdSlide() {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const slotId = process.env.NEXT_PUBLIC_ADSENSE_SLOT_ID;

  useEffect(() => {
    if (!clientId || !slotId) return;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch {
      /* ad blocked or script not loaded — fail silently, never block the feed */
    }
  }, [clientId, slotId]);

  if (!clientId || !slotId) return null;

  return (
    <section className="flex h-dvh snap-start flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="text-xs uppercase tracking-wide text-neutral-500">Sponsored</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%", maxWidth: "360px", minHeight: "250px" }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </section>
  );
}
