// Qbar service worker: notiser och en sida utan nät. Ingen cache: appen ska alltid hämta färsk kod och färska köer.
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

// Utan nät: en egen sida i stället för webbläsarens fel (eller en vit hemskärmsapp). Den lovar inga köer, för vi har
// inga, och har en knapp för att försöka igen. Bara sidladdningar; allt annat går direkt till nätet som förut.
var OFFLINE_HTML = '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<meta name="theme-color" content="#0B0B0D"><title>Qbar · ingen anslutning</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;' +
  'justify-content:center;background:#0B0B0D;color:#F5F5F4;font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center}main{padding:24px;max-width:320px}' +
  'h1{font-size:22px;margin:0 0 8px}p{color:#A8A8A4;margin:0 0 24px}button{min-height:48px;padding:0 24px;border-radius:12px;border:0;background:#5B9BFF;' +
  'color:#0B0B0D;font:700 16px inherit}</style></head><body><main><h1>Ingen internetanslutning</h1><p>Qbar behöver nätet för att visa köerna just nu.</p>' +
  '<button onclick="location.reload()">Försök igen</button></main></body></html>';
self.addEventListener('fetch', function(e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(function() {
    return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});

// Varje push måste visa en notis, annars drar iOS in tillståndet.
self.addEventListener('push', function(e) {
  var n = null;
  try { n = e.data && e.data.json(); } catch (err) {}
  n = n || { title: 'Qbar', body: 'Ny rapport från en favorit' };
  e.waitUntil(self.registration.showNotification(n.title, {
    body: n.body, tag: n.tag, renotify: !!n.tag, // samma ställe: den nya ersätter den förra, men surrar ändå
    icon: '/icons/icon-192.png', data: { url: n.url || '/' }
  }));
});

// Tryck på notisen: öppen app visar stället direkt, annars startar appen med ?venue=.
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = new URL(e.notification.data.url, self.location.origin);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    if (list[0]) { list[0].postMessage({ venue: url.searchParams.get('venue') }); return list[0].focus(); }
    return self.clients.openWindow(url.href);
  }));
});
