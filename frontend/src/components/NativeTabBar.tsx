import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hapticLight } from '../native/haptics'
import { isNativeApp } from '../native/platform'
import './NativeTabBar.css'

const HIDDEN_PREFIXES = [
  '/login',
  '/signup',
  '/privacy',
  '/terms',
  '/about',
  '/blog',
  '/admin',
  '/organiser',
  '/tournament/',
  '/welcome',
  '/join',
  '/404',
]

export function nativeTabsHiddenForPath(pathname: string): boolean {
  if (pathname === '/') return true
  // Keep match-day focus — no bottom tabs over live scoring / join
  if (/^\/t\/[^/]+\/(live|join|confirmed)(\/|$)/.test(pathname)) return true
  if (pathname.startsWith('/t/join/')) return true
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
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

  const profileTo = user ? `/players/${user.id}` : '/login?next=%2Ftournaments'

  return (
    <nav className="native-tab-bar" aria-label="Main">
      <NavLink
        to="/tournaments"
        className={({ isActive }) =>
          `native-tab ${isActive || pathname.startsWith('/t/') ? 'is-active' : ''}`
        }
        onClick={() => void hapticLight()}
      >
        <i className="fas fa-trophy" aria-hidden />
        <span>Tournaments</span>
      </NavLink>
      <NavLink
        to="/community"
        className={({ isActive }) =>
          `native-tab ${isActive || pathname.startsWith('/community') ? 'is-active' : ''}`
        }
        onClick={() => void hapticLight()}
      >
        <i className="fas fa-users" aria-hidden />
        <span>Community</span>
      </NavLink>
      <NavLink
        to="/rankings"
        className={({ isActive }) => `native-tab ${isActive ? 'is-active' : ''}`}
        onClick={() => void hapticLight()}
      >
        <i className="fas fa-ranking-star" aria-hidden />
        <span>Rankings</span>
      </NavLink>
      <NavLink
        to={profileTo}
        className={({ isActive }) =>
          `native-tab ${isActive || (user && pathname.startsWith('/players/')) ? 'is-active' : ''}`
        }
        onClick={() => void hapticLight()}
      >
        <i className="fas fa-user" aria-hidden />
        <span>{user ? 'Profile' : 'Account'}</span>
      </NavLink>
    </nav>
  )
}
