// Only cache icons — never cache HTML or JS so updates are instant
const CACHE = 'pocket-money-icons-v3';
const ICON_ASSETS = ['/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ICON_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never intercept Netlify functions or Firebase
  if (url.includes('/.netlify/') || url.includes('firebase') || url.includes('gstatic')) return;

  // Only serve icons from cache — everything else always goes to network
  if (url.includes('/icons/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // index.html, config.js, sw.js — always network, never cache
  // This ensures deploys are picked up immediately
});

// ── Push notification received ─────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch(err) { data = { title: 'Pocket Money', body: e.data.text() }; }

  const actions = [];
  if (data.completionId && data.for) {
    actions.push({ action: 'approve', title: '✓ Approve' });
  }

  e.waitUntil(
    self.registration.showNotification(data.title || 'Pocket Money', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'pocket-money',
      renotify: true,
      actions: actions,
      data: { url: '/', completionId: data.completionId || null, for: data.for || null }
    })
  );
});

// ── Notification click — open/focus the app ────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const notifData = e.notification.data || {};

  let url = '/';
  if (e.action === 'approve' && notifData.completionId && notifData.for) {
    url = '/?approve=' + notifData.completionId + '&for=' + notifData.for;
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (url !== '/') client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
