(() => {
  const storageKey = 'kc-web-push-device:' + new URL('.', location.href).pathname;
  const bindingCache = 'kc-device-binding-v1';
  const storedDevice = () => {
    try { return JSON.parse(localStorage.getItem(storageKey)); }
    catch { return null; }
  };
  const rememberDevice = device => {
    if (device) localStorage.setItem(storageKey, JSON.stringify(device));
    else localStorage.removeItem(storageKey);
  };
  const binding = async (registration, id) => {
    const cache = await caches.open(bindingCache);
    const key = new URL('__push-device', registration.scope);
    if (id) await cache.put(key, new Response(id));
    else await cache.delete(key);
  };
  let pendingDeviceWork = Promise.resolve();
  const deviceLock = action => {
    if (navigator.locks) return navigator.locks.request(storageKey, action);
    const work = pendingDeviceWork.then(action);
    pendingDeviceWork = work.catch(() => {});
    return work;
  };

  async function removeDevice(db, owner) {
    const device = storedDevice();
    if (!device || (owner && device.owner !== owner)) return;
    const local = async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (!registration) return;
      const results = await Promise.allSettled([
        binding(registration, null),
        registration.pushManager?.getSubscription().then(sub => sub?.unsubscribe()),
        registration.getNotifications?.().then(notices => {
          for (const notice of notices) if (notice.data?.device) notice.close();
        }),
      ]);
      if (results[0].status === 'rejected' || results[1].status === 'rejected') {
        throw new Error('Push cleanup incomplete');
      }
    };
    const remote = async () => {
      if (!db) return;
      const { error } = await db.rpc('disable_web_push', { p_proof: device.proof })
        .abortSignal(AbortSignal.timeout(2000));
      if (error) throw error;
    };
    const [client, server] = await Promise.allSettled([local(), remote()]);
    if (client.status === 'fulfilled') rememberDevice(null);
    if (client.status === 'rejected' || server.status === 'rejected') throw new Error('Push cleanup incomplete');
  }

  const disconnect = (db, owner) => deviceLock(() => removeDevice(db, owner));
  const reconcile = owner => {
    return deviceLock(() => {
      const device = storedDevice();
      if (device && device.owner !== owner) return removeDevice(null, device.owner);
    });
  };
  const lifecycle = { storedDevice, rememberDevice, binding, deviceLock, removeDevice, reconcile };
  const pushModule = () => import('./web-push-settings.js');
  window.KinballWebPush = {
    disconnect(db, owner) {
      return disconnect(db, owner).catch(() => console.warn('[pwa] push device cleanup incomplete'));
    },
    reconcile(owner) {
      return reconcile(owner).catch(() => console.warn('[pwa] push account reconciliation incomplete'));
    },
  };
  window.addEventListener('storage', event => {
    if (!event.key?.startsWith('sb-')) return;
    try {
      const supabaseUrl = window.KinballCoach?.app?.SUPABASE_URL ||
        (typeof SUPABASE_URL === 'string' ? SUPABASE_URL : null);
      if (!supabaseUrl || event.key !== 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token') return;
      const owner = JSON.parse(event.newValue)?.user?.id;
      window.KinballWebPush.reconcile(owner);
    } catch { /* Ignore storage changes unrelated to a Supabase session. */ }
  });
  document.addEventListener('click', async event => {
    const opener = event.target.closest?.('[data-open-web-push]');
    const app = window.KinballCoach?.app;
    if (!opener || !app?.currentUser) return;
    try { (await pushModule()).openSettings(app.db, app.currentUser?.id, lifecycle); }
    catch { console.warn('[pwa] push settings unavailable'); }
  });

  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js', { scope: './', updateViaCache: 'none' })
      .then(registration => registration.update().catch(() => {}))
      .catch(error => console.warn('[pwa] service worker registration failed', error));
  });
})();
