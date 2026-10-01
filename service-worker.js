const VERSION = 'kinball-coach-pwa-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('kinball-coach-'))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

// Pas de stratégie de cache pour l'instant.
// La PWA reste installable, mais le chargement de l'application reste network-first.
