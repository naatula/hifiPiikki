const CACHE_VERSION = 'piikki-v2.1'

const PRECACHE_URLS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './offline.js',
    './app.webmanifest',
    './OpenSans.ttf',
    './icon-192.png',
    './icon-256.png',
    './icon-512.png',
    './purchase.m4a',
]

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(PRECACHE_URLS))
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    )
})

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url)

    if (url.origin !== self.location.origin) return
    if (!url.pathname.startsWith(self.registration.scope)) return

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone = response.clone()
                    caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone))
                    return response
                })
                .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
        )
        return
    }

    if (event.request.method === 'GET') {
        event.respondWith(
            caches.match(event.request).then(cached => {
                const networkFetch = fetch(event.request).then(response => {
                    const clone = response.clone()
                    caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone))
                    return response
                }).catch(() => cached)
                return cached || networkFetch
            })
        )
        return
    }
})

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting()
    }
})
