// Throughline's service worker: just enough for the app to open with no signal, so a note can
// still be captured (the notes themselves wait in IndexedDB; see src/offline/). Hand-written,
// plain JS because it is copied to /sw.js as is. Registered from src/main.tsx in production.
//
// - Page loads: network first, falling back to the cached app shell.
// - /assets/* (hashed names, so a cached copy is never stale), the icons and the manifest:
//   cache first.
// - /api/*: never cached. A note that cannot be sent waits in the offline queue instead.
//
// Bump VERSION to drop every cached file once the new worker activates.
const VERSION = 1;
const CACHE = `throughline-v${VERSION}`;
const STATIC = ["/manifest.webmanifest", "/favicon.svg", "/icons/apple-touch-icon.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"];
// Every page is the same index.html (a single-page app). It is fetched as "/" because
// Cloudflare redirects /index.html there, and a redirected response cannot answer a page load.
const SHELL = "/";
// How long a page load waits for the network before showing the cached app: one bar of
// signal can hang a request for a minute.
const NAVIGATE_TIMEOUT_MS = 3000;

const isHtml = (res) => (res.headers.get("content-type") ?? "").includes("text/html");
const assetPaths = (text) => [...new Set(text.match(/\/assets\/[\w.-]+/g) ?? [])];

// The shell: index.html, the scripts and styles it names, and the fonts the styles name, so
// the first reload with no signal works even though the first visit loaded them uncached.
async function cacheShell(cache) {
  const res = await fetch(SHELL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${SHELL} → ${res.status}`);
  const files = assetPaths(await res.clone().text());
  await cache.put(SHELL, res);
  await cache.addAll(files);
  for (const css of files.filter((f) => f.endsWith(".css"))) {
    const sheet = await cache.match(css);
    if (sheet) await cache.addAll(assetPaths(await sheet.text()));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(STATIC);
      await cacheShell(cache);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("throughline-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Network first, so a deploy shows on the next load; the fresh page is kept for offline. With
// no answer in time, the cached shell opens and the network reply still refreshes it.
async function page(event) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(async (res) => {
    if (res.ok && !res.redirected && isHtml(res)) await cache.put(SHELL, res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  const cached = await cache.match(SHELL);
  if (!cached) return network;
  const late = new Promise((resolve) => setTimeout(() => resolve(cached), NAVIGATE_TIMEOUT_MS));
  try {
    return await Promise.race([network, late]);
  } catch {
    return cached;
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // A missing file comes back as index.html (the single-page fallback): never worth keeping.
  if (res.ok && !isHtml(res)) await cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") event.respondWith(page(event));
  else if (url.pathname.startsWith("/assets/") || STATIC.includes(url.pathname)) event.respondWith(asset(request));
});
