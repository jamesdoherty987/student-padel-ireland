import { isNativeApp } from '../native/platform'

/** Allow only same-origin relative paths (blocks //evil.com open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = ''): string {
  if (!next) return fallback
  const trimmed = next.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  // Native shell: never bounce through marketing pages after login
  if (isNativeApp() && isWebOnlyPath(trimmed.split('?')[0] || trimmed)) {
    return fallback || '/tournaments'
  }
  return trimmed
}

/** Default post-login / home destination for a role. */
export function homeForRole(role: string | undefined | null): string {
  return role === 'ADMIN' ? '/admin' : '/tournaments'
}

/**
 * Auth / logout destination - never the marketing landing inside the native shell.
 * Guests → login; signed-in → role home.
 */
export function appHomePath(role?: string | null | undefined): string {
  if (isNativeApp()) {
    return role ? homeForRole(role) : '/login'
  }
  return role ? homeForRole(role) : '/'
}

/**
 * Where the brand mark / “browse” CTAs should go for guests inside the app chrome.
 * Cold start still opens login; once browsing, stay in Tournaments.
 */
export function guestBrowsePath(): string {
  return isNativeApp() ? '/tournaments' : '/'
}

/** Marketing / SEO routes that must not open inside the Capacitor app. */
export function isWebOnlyPath(pathname: string): boolean {
  if (pathname === '/about' || pathname.startsWith('/about/')) return true
  if (pathname === '/blog' || pathname.startsWith('/blog/')) return true
  return false
}

/** Remap deep links / accidental navigations away from web-only marketing pages. */
export function nativeSafePath(pathnameWithSearch: string): string {
  const q = pathnameWithSearch.indexOf('?')
  const path = q >= 0 ? pathnameWithSearch.slice(0, q) : pathnameWithSearch
  const search = q >= 0 ? pathnameWithSearch.slice(q) : ''
  // App entry / legacy welcome → auth
  if (path === '/' || path === '/welcome') {
    return `/login${search}`
  }
  // SEO pages → main feed (not a second trip through login)
  if (isWebOnlyPath(path)) {
    return `/tournaments${search}`
  }
  return pathnameWithSearch
}

/**
 * Tab roots have no back control. Nested screens return a safe fallback path
 * for the top-bar back button (cold start / no history).
 */
export function nativeBackFallback(
  pathname: string,
  userId?: string | null,
  role?: string | null,
): string | null {
  if (
    pathname === '/tournaments' ||
    pathname === '/community' ||
    pathname === '/rankings' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/welcome'
  ) {
    return null
  }
  // Admin home is their post-login landing - no back chrome
  if (pathname === '/admin' && role === 'ADMIN') {
    return null
  }
  if (userId && (pathname === `/players/${userId}` || pathname.startsWith(`/players/${userId}/`))) {
    return null
  }

  if (pathname.startsWith('/community')) return '/community'
  if (pathname.startsWith('/players/')) return '/rankings'
  if (pathname.startsWith('/t/')) {
    const nested = pathname.match(/^\/t\/([^/]+)\/(live|join|confirmed)(\/|$)/)
    if (nested) return `/t/${nested[1]}`
    return '/tournaments'
  }
  if (pathname.startsWith('/organiser')) {
    return '/tournaments'
  }
  if (pathname.startsWith('/join')) {
    return '/tournaments'
  }
  if (pathname.startsWith('/admin')) {
    return userId ? `/players/${userId}` : '/tournaments'
  }
  if (pathname.startsWith('/privacy') || pathname.startsWith('/terms') || pathname.startsWith('/404')) {
    return role ? homeForRole(role) : '/tournaments'
  }
  return '/tournaments'
}
