import { useLocation } from 'react-router-dom'
import { usePageSeo } from '../hooks/usePageSeo'

/** True when the matched page component sets its own usePageSeo. */
function hasOwnSeo(pathname: string): boolean {
  if (pathname === '/') return true
  if (pathname === '/404') return true
  if (
    pathname === '/blog' ||
    pathname.startsWith('/blog/') ||
    pathname === '/about' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/tournaments' ||
    pathname === '/rankings' ||
    pathname === '/community' ||
    pathname === '/join' ||
    pathname.startsWith('/join/')
  ) {
    return true
  }
  // Tournament detail only: /t/:slug (not /join, /live, /confirmed)
  if (/^\/t\/[^/]+$/.test(pathname)) return true
  return false
}

/**
 * Clears stale meta when navigating to app routes that don't set their own SEO
 * (organiser, admin, profiles, live/TV, community detail, etc.).
 */
export default function RouteSeoFallback() {
  const { pathname } = useLocation()
  const own = hasOwnSeo(pathname)

  usePageSeo({
    enabled: !own,
    title: 'Student Padel Ireland',
    description:
      'Student Padel Ireland - student padel tournaments, community games, and rankings across Ireland.',
    path: pathname,
    noIndex: true,
  })

  return null
}
