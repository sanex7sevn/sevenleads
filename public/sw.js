const CACHE = 'sevenleads-v7';
const ASSETS = [
  '/', '/styles/tailwind.css', '/styles/app.css', '/app.js', '/js/api.js', '/js/ui.js',
  '/js/state.js', '/js/session.js', '/js/whatsapp-panel.js', '/js/leads-panel.js',
  '/js/billing-admin.js', '/js/features.js', '/logo.png', '/background-casino.webp'
];

self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || (/^\/(api|admin)(\/|$)/).test(new URL(event.request.url).pathname)) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))));
});
