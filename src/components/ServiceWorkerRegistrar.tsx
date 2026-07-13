"use client";

import { useEffect } from "react";

/** Registers the offline service worker (production only — it would serve
 * stale chunks against the dev server's unhashed assets). */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is an enhancement — never block the app on it */
    });
  }, []);
  return null;
}
