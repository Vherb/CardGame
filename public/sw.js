// Lightweight service worker to make the app installable and enable updates
// Updates: bump the VERSION string to force a new SW and trigger an update on clients
const VERSION = 'v' + (self.registration?.scope || '') + '-' + (Date.now());

self.addEventListener('install', (event) => {
  // Activate new SW immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Take control of existing clients right away so updates apply faster
    await self.clients.claim();
  })());
});

// Minimal fetch handler to satisfy installability criteria without caching
self.addEventListener('fetch', (event) => {
  // Pass-through network request; do not cache by default
  event.respondWith(fetch(event.request));
});
