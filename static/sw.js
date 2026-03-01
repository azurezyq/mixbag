const CACHE_NAME = 'mixbag-pwa-v1';
const urlsToCache = [
    '/',
    '/manifest.json',
    '/static/css/style.css',
    '/static/js/main.js',
    '/static/img/icon-192.png',
    '/static/img/icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                // Ignoring failure for individual files to avoid blocking install
                return Promise.allSettled(urlsToCache.map(url => cache.add(url)));
            })
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
