import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hapticLight } from '../native/haptics'
import { isNativeApp } from '../native/platform'
import './NativeTabBar.css'

/**
 * Instagram-style: keep the bottom bar on almost every screen.
 * Hide only for auth/onboarding and true full-screen experiences.
 */
export function nativeTabsHiddenForPath(pathname: string): boolean {
  if (pathname === '/welcome' || pathname === '/') return true
  if (pathname === '/login' || pathname.startsWith('/login/')) return true
  if (pathname === '/signup' || pathname.startsWith('/signup/')) return true
  // Match-day live scoring — full focus, no chrome distraction
  if (/^\/t\/[^/]+\/live(\/|$)/.test(pathname)) return true
  // Venue TV display
  if (pathname.startsWith('/tournament/')) return true
  return false
}

export function nativeTabsVisibleForPath(pathname: string): boolean {
  return isNativeApp() && !nativeTabsHiddenForPath(pathname)
}

export default function NativeTabBar() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const visible = nativeTabsVisibleForPath(pathname)

  useEffect(() => {
    document.documentElement.classList.toggle('has-native-tabs', visible)
    return () => document.documentElement.classList.remove('has-native-tabs')
  }, [visible])

  if (!visible) return null

  // After login, land on role home — guests don't have a profile yet
  const profileTo = user ? `/players/${user.id}` : '/login'
  const onOwnProfile = Boolean(user && pathname === `/players/${user.id}`)
  const onOtherProfile = pathname.startsWith('/players/') && !onOwnProfile
  const onTournaments =
    pathname.startsWith('/tournaments') ||
    pathname.startsWith('/t/') ||
    pathname.startsWith('/join') ||
    pathname.startsWith('/organiser') ||
    pathname.startsWith('/admin')
  const onCommunity = pathname.startsWith('/community')
  const onRankings = pathname.startsWith('/rankings') || onOtherProfile

  return (
    <nav className="native-tab-bar" aria-label="Main">
      <NavLink
        to="/tournaments"
        className={() => `native-tab ${onTournaments ? 'is-active' : ''}`}
        onClick={() => void hapticLight()}
        end={false}
      >
        <span className="native-tab-icon" aria-hidden>
          <i className="fas fa-trophy" />
        </span>
        <span>Events</span>
      </NavLink>
      <NavLink
        to="/community"
        className={() => `native-tab ${onCommunity ? 'is-active' : ''}`}
        onClick={() => void hapticLight()}
      >
        <span className="native-tab-icon" aria-hidden>
          <i className="fas fa-users" />
        </span>
        <span>Community</span>
      </NavLink>
      <NavLink
        to="/rankings"
        className={() => `native-tab ${onRankings ? 'is-active' : ''}`}
        onClick={() => void hapticLight()}
      >
        <span className="native-tab-icon" aria-hidden>
          <i className="fas fa-ranking-star" />
        </span>
        <span>Rankings</span>
      </NavLink>
      <NavLink
        to={profileTo}
        className={() => `native-tab ${onOwnProfile ? 'is-active' : ''}`}
        onClick={() => void hapticLight()}
      >
        <span className="native-tab-icon" aria-hidden>
          <i className="fas fa-user" />
        </span>
        <span>{user ? 'Profile' : 'Account'}</span>
      </NavLink>
    </nav>
  )
}
