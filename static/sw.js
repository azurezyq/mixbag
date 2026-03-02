const CACHE_NAME = 'mixbag-pwa-v4';
const urlsToCache = [
    '/',
    '/manifest.json',
    '/css/style.css',
    '/js/main.js',
    '/img/icon-192.png',
    '/img/icon-512.png'
];

self.addEventListener('install', event => {
    // Skip waiting so this SW takes over immediately without requiring a tab close
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.allSettled(urlsToCache.map(url => cache.add(url))))
    );
});

self.addEventListener('activate', event => {
    // Delete all old caches that don't match the current version
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim()) // Take control of all open tabs
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    // Network-first: always try to get latest JS/HTML, fall back to cache offline
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
