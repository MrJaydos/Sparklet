/**
 * Offline support for spotty-connection commutes. The feed already fetches
 * batches ahead of the viewport and prefetches their images; this worker
 * keeps those responses so scrolling keeps working when the network drops.
 *
 * - /_next/static/*  cache-first (content-hashed, immutable)
 * - images           cache-first, trimmed to a cap
 * - /api/feed        network-first; offline falls back to the last batch
 *                    for the same category selection (exclude list ignored)
 * - navigations      network-first; offline falls back to the cached page,
 *                    then to the cached /feed shell
 */

const STATIC_CACHE = "sparklet-static-v1";
const PAGE_CACHE = "sparklet-pages-v1";
const DATA_CACHE = "sparklet-data-v1";
const IMG_CACHE = "sparklet-img-v1";
const IMG_CACHE_MAX = 200;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE, DATA_CACHE, IMG_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(cacheName, request, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === "opaque") {
    cache.put(request, res.clone());
    if (maxEntries) trimCache(cache, maxEntries);
  }
  return res;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  // Cache keys are ordered oldest-first; drop from the front.
  for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
}

// The exclude param changes on every /api/feed call; key the cache on the
// category selection only, so offline gets "the last batch for these topics".
function feedCacheKey(url) {
  const u = new URL(url);
  const categories = u.searchParams.get("categories") ?? "";
  return `${u.origin}${u.pathname}?categories=${categories}`;
}

async function feedNetworkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  const key = feedCacheKey(request.url);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    return new Response(JSON.stringify({ cards: [], quizzes: [], exhausted: false }), {
      headers: { "content-type": "application/json" },
    });
  }
}

async function pageNetworkFirst(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    const feedShell = await cache.match("/feed");
    if (feedShell) return feedShell;
    return new Response("Offline — reconnect to keep learning.", {
      status: 503,
      headers: { "content-type": "text/plain" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(STATIC_CACHE, request));
  } else if (url.origin === location.origin && url.pathname === "/api/feed") {
    event.respondWith(feedNetworkFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(pageNetworkFirst(request));
  } else if (request.destination === "image") {
    event.respondWith(cacheFirst(IMG_CACHE, request, IMG_CACHE_MAX));
  }
});
