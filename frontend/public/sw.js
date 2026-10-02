/* Student Padel Ireland - lightweight PWA service worker */
const CACHE = 'spi-shell-v4'
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

  // Never cache API or uploads
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/health') ||
    url.pathname.startsWith('/uploads')
  ) {
    return
  }

  // Hashed build assets: network-only (avoid pinning broken chunks after deploys)
  if (url.pathname.startsWith('/assets/')) {
    return
  }

  // Navigations + shell: network-first, fall back to cached index for offline
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request)
        if (res.ok && request.mode === 'navigate') {
          const cache = await caches.open(CACHE)
          cache.put('/index.html', res.clone())
        }
        return res
      } catch {
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html')
          if (shell) return shell
          const root = await caches.match('/')
          if (root) return root
        }
        const cached = await caches.match(request)
        if (cached) return cached
        return Response.error()
      }
    })(),
  )
})
