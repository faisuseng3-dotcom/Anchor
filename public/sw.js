// Qbar service worker: bara notiser. Ingen cache: appen ska alltid hämta färsk kod och färska köer.
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

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
