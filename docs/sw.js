// Bump this version whenever any controller asset changes.
const CACHE = `btweb-controller-development:${self.registration.scope}`;
const ASSETS = ['./', './index.html', './style.css', './controller.html', './controller/app.js', './controller/ble.js', './controller/devices.js', './controller/build.js', './controller/updates.js', './manifest.webmanifest'];
const assetUrls = ASSETS.map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(assetUrls)));
});
self.addEventListener('activate', event => {
  // Cache names include scope: other repositories on this GitHub Pages origin
  // must not be removed. This version keeps old caches until a managed update.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // Explicit updates must reach the network, including when the same commit
  // is reloaded. Never cache the pointer to the newest release.
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.cache === 'reload' || url.searchParams.has('reload')) {
    event.respondWith(fetch(event.request).then(async response => {
      if (response.ok) {
        const key = new URL(url); key.search = '';
        const cache = await caches.open(CACHE);
        await cache.put(key.href, response.clone());
      }
      return response;
    }));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    return fetch(event.request);
  }));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_CACHE' || !event.ports[0]) return;
  event.waitUntil(caches.open(CACHE).then(async cache => {
    const results = await Promise.all(assetUrls.map(url => cache.match(url)));
    event.ports[0].postMessage({ ready: results.every(Boolean) });
  }));
});
