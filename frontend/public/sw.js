/* Student Padel Ireland — lightweight PWA service worker */
const CACHE = 'spi-shell-v2'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache API or uploads — uploads live on the API host in production
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/health') ||
    url.pathname.startsWith('/uploads')
  ) {
    return
  }

  // App shell / assets: network-first, fall back to cache (SPA-friendly)
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request)
        if (res.ok && (url.pathname.startsWith('/assets') || request.mode === 'navigate')) {
          const cache = await caches.open(CACHE)
          cache.put(request, res.clone())
        }
        return res
      } catch {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html')
          if (shell) return shell
        }
        return Response.error()
      }
    })(),
  )
})
