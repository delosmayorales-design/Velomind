const CACHE_NAME = 'velomind-v3';
const ASSETS = [
  './',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/backend-sync.js',
  './logo2.png',
  './logoPerfil.PNG'
];

// Instalar y guardar en caché los archivos básicos
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Fuerza a que el nuevo Service Worker se active inmediatamente
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Limpiar cachés antiguos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim())
  );
});

// Interceptar peticiones (Network First para asegurar archivos siempre actualizados)
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) return; // No cachear la base de datos

  e.respondWith(
    fetch(e.request).then((res) => {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(e.request, res.clone());
        return res;
      });
    }).catch(() => {
      return caches.match(e.request);
    })
  );
});

// Abrir la app al pulsar una notificación
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || './nutrition.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('velomind') || c.url.includes('localhost'));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

// Recibir push del backend (preparado para el futuro)
self.addEventListener('push', (e) => {
  if (!e.data) return;
  const d = e.data.json();
  e.waitUntil(
    self.registration.showNotification(d.title || 'VeloMind', {
      body: d.body || '',
      icon: './logoPerfil.PNG',
      badge: './logoPerfil.PNG',
      data: { url: d.url || './nutrition.html' },
      tag: d.tag || 'velomind',
    })
  );
});