// Retirement worker at the historical PWA URL. Keep serving this file so an
// installed/offline-era client can discover the replacement when online again.
// No fetch handler, game imports or offline caching: requests go to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // VitePWA/Workbox's default precache name includes the full registration
    // scope. Match exactly: never clear unrelated caches, IndexedDB or saves.
    const ownedCache = `workbox-precache-v2-${self.registration.scope}`;
    await caches.delete(ownedCache);
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    await self.registration.unregister();
    await Promise.all(clients.map(async (client) => {
      const url = new URL(client.url);
      if (url.origin !== self.location.origin) return;
      // Return old game routes to the marketing front door, but preserve policy
      // pages. Navigating also stops a game already running in an open tab.
      const path = /^\/(privacy|terms|support)(\.html)?\/?$/.test(url.pathname)
        ? url.pathname : '/';
      try { await client.navigate(path); } catch { /* Tab may already be closed. */ }
    }));
  })());
});
