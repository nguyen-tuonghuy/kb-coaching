const VERSION = 'kinball-coach-pwa-v3';

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

const PUSH_CACHE = 'kc-device-binding-v1';
const WEB_PUSH_UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const PUSH_COPY = {
  video: ['Nouvelle vidéo disponible', 'Retrouve ta vidéo dans Kinball Coach.'],
  annotation: ['Nouvelle annotation vidéo', 'Consulte ton analyse dans Kinball Coach.'],
  analysis: ['Nouvelle annotation vidéo', 'Consulte ton analyse dans Kinball Coach.'],
  message: ['Nouveau message', 'Ouvre Kinball Coach pour lire ton message.'],
  collection: ['Collecte de statistiques ouverte', 'Ouvre ton suivi pour saisir tes résultats.'],
  test: ['Notification de test', 'Les notifications Kinball Coach fonctionnent sur cet appareil.'],
};

async function pushBinding() {
  const cache = await caches.open(PUSH_CACHE);
  const response = await cache.match(new URL('__push-device', self.registration.scope));
  return response ? response.text() : '';
}

function pushDestination(data) {
  const group = WEB_PUSH_UUID.test(data.group) ? data.group : null;
  const player = WEB_PUSH_UUID.test(data.player) ? data.player : null;
  const query = new URLSearchParams();
  if (data.kind === 'message' && group && data.staff && player) {
    query.set('staff_group', group);
    query.set('staff_player', player);
    return 'index.html?' + query + '#player-follow-up-messages';
  }
  if (data.kind === 'video' && data.staff && group && player) {
    query.set('group', group);
    query.set('player', player);
    return 'videos.html?' + query;
  }
  if (group) query.set('player_group', group);
  const hashes = { message: '#player-messages', collection: '#player-results',
    video: '#player-videos', annotation: '#player-videos', analysis: '#player-videos' };
  const hash = hashes[data.kind] || '';
  const search = query.toString();
  return 'index.html' + (search ? '?' + search : '') + hash;
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || !Object.hasOwn(PUSH_COPY, payload.kind) || !WEB_PUSH_UUID.test(payload.id)
      || !WEB_PUSH_UUID.test(payload.device) || payload.device !== await pushBinding()) return;
    const [title, body] = payload.kind === 'video' && payload.staff === true
      ? ['Nouvelle vidéo d’un joueur', 'Consulte la vidéo dans Kinball Coach.']
      : PUSH_COPY[payload.kind];
    await self.registration.showNotification(title, {
      body,
      icon: new URL('kinball-brand/logo-symbol.png', self.registration.scope).href,
      badge: new URL('kinball-brand/favicon.png', self.registration.scope).href,
      tag: payload.id,
      data: { device: payload.device, kind: payload.kind, group: payload.group, player: payload.player, staff: payload.staff === true },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    if (!data || data.device !== await pushBinding() || !Object.hasOwn(PUSH_COPY, data.kind)) return;
    const scope = new URL(self.registration.scope);
    const target = new URL(pushDestination(data), scope);
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === target.href) ||
      windows.find(client => client.url.startsWith(scope.href));
    if (existing) {
      if (existing.url === target.href) return existing.focus();
      const navigated = await existing.navigate?.(target.href).catch(() => null);
      if (navigated) return navigated.focus();
    }
    return clients.openWindow(target.href);
  })());
});
