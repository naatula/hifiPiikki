const CACHE_VERSION = 'piikki-v3.13'

// Core shell: must ALL cache or the install aborts, leaving the previous
// (working) service worker in control rather than activating a half-broken
// offline build. The PWA's start_url (./index.html) lives here.
const PRECACHE_CRITICAL = [
    './index.html',
    './styles.css',
    './app.js',
    './offline.js',
    './toast.js',
]

// Best-effort extras: the app still runs offline without any single one of
// these, so a missing/renamed icon, font or sound must not fail the install.
// './' is here too — under Django static serving the directory root may 404,
// and offline navigation falls back to './index.html' regardless.
const PRECACHE_OPTIONAL = [
    './',
    './app.webmanifest',
    './OpenSans.ttf',
    './icon-192.png',
    './icon-256.png',
    './icon-512.png',
    './purchase.m4a',
]

self.addEventListener('install', (event) => {
    const bust = (url) => new Request(url, { cache: 'reload' })
    event.waitUntil(
        caches.open(CACHE_VERSION).then(async (cache) => {
            await cache.addAll(PRECACHE_CRITICAL.map(bust))
            await Promise.allSettled(PRECACHE_OPTIONAL.map(u => cache.add(bust(u))))
        })
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Run the shell network fetch in parallel with SW startup on future
        // navigations (consumed below via event.preloadResponse).
        if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.enable()
        }
        const keys = await caches.keys()
        await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
        await self.clients.claim()
    })())
})

// self.registration.scope is a full URL (e.g. http://host/static/); compare
// against its pathname, not the raw scope string, or every request bails out.
const SCOPE_PATH = new URL(self.registration.scope).pathname

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url)

    if (url.origin !== self.location.origin) return
    if (!url.pathname.startsWith(SCOPE_PATH)) return

    // ignoreSearch so a request carrying a query string (e.g. a cache-busting
    // suffix) still matches the precached entry stored without one.
    if (event.request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const response = (await event.preloadResponse) || (await fetch(event.request, { cache: 'reload' }))
                // Only cache a good shell — never let a 5xx error page overwrite
                // the cached index that keeps the app usable offline.
                if (response && response.ok) {
                    const clone = response.clone()
                    caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone))
                }
                return response
            } catch {
                return (await caches.match(event.request, { ignoreSearch: true }))
                    || caches.match('./index.html')
            }
        })())
        return
    }

    if (event.request.method === 'GET') {
        event.respondWith(
            caches.match(event.request, { ignoreSearch: true }).then(cached => {
                const networkFetch = fetch(event.request, { cache: 'reload' }).then(response => {
                    if (response && response.ok) {
                        const clone = response.clone()
                        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone))
                    }
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
