const CACHE_NAME = 'velomind-v1';
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
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Interceptar peticiones (Cache First para archivos, Network para la API)
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) return; // No cachear la base de datos
  
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});