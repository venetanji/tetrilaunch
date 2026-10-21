// Only update the known root game registration. New marketing visitors do not
// get a service worker, and other applications' scopes/registrations stay alone.
(async () => {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration || registration.scope !== new URL('/', location.href).href) return;
    const worker = registration.active || registration.waiting || registration.installing;
    if (!worker || worker.scriptURL !== new URL('/sw.js', location.href).href) return;
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  } catch {
    // Restricted storage or offline browsers must still be able to read the page.
  }
})();
