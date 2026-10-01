(() => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js', { scope: './', updateViaCache: 'none' })
      .then(registration => registration.update().catch(() => {}))
      .catch(error => console.warn('[pwa] service worker registration failed', error));
  });
})();
