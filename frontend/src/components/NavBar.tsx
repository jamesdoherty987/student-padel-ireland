import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isNativeApp } from '../native/platform'
import { homeForRole } from '../utils/navigation'
import BrandLogo from './BrandLogo'
import { nativeTabsVisibleForPath } from './NativeTabBar'
import NotificationsBell from './NotificationsBell'
import './AppSidebar.css'

const DESKTOP_MIN = 961

type NavItem = {
  to: string
  label: string
  icon: string
  match?: (pathname: string) => boolean
}

function linkActive(pathname: string, item: NavItem, isActive: boolean) {
  if (item.match) return item.match(pathname)
  return isActive
}

function useIsDesktopNav() {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN && !isNativeApp(),
  )
  useEffect(() => {
    const sync = () => setDesktop(window.innerWidth >= DESKTOP_MIN && !isNativeApp())
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])
  return desktop
}

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const native = isNativeApp()
  const desktop = useIsDesktopNav()
  const tabsVisible = nativeTabsVisibleForPath(pathname)
  const menuId = useId()
  const scrollYRef = useRef(0)

  // Drawer mode: mobile web or any native shell
  const drawerMode = !desktop

  useEffect(() => {
    document.documentElement.classList.add('has-app-sidebar')
    return () => document.documentElement.classList.remove('has-app-sidebar')
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (desktop) setOpen(false)
  }, [desktop])

  useEffect(() => {
    if (!open || !drawerMode) {
      document.body.classList.remove('mobile-menu-open')
      if (document.body.style.position === 'fixed') {
        const y = scrollYRef.current
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.left = ''
        document.body.style.right = ''
        document.body.style.width = ''
        window.scrollTo(0, y)
      }
      return
    }

    scrollYRef.current = window.scrollY
    document.body.classList.add('mobile-menu-open')
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollYRef.current}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'

    return () => {
      document.body.classList.remove('mobile-menu-open')
      const y = scrollYRef.current
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      document.body.style.width = ''
      window.scrollTo(0, y)
    }
  }, [open, drawerMode])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const close = () => setOpen(false)

  const onLogout = () => {
    close()
    logout()
    navigate(native ? '/welcome' : '/')
  }

  const brandTo = native ? (user ? homeForRole(user.role) : '/welcome') : user ? homeForRole(user.role) : '/'

  const primary: NavItem[] = [
    {
      to: '/tournaments',
      label: 'Tournaments',
      icon: 'fa-trophy',
      match: (p) => p.startsWith('/tournaments') || p.startsWith('/t/') || p.startsWith('/join'),
    },
    {
      to: '/community',
      label: 'Community',
      icon: 'fa-users',
      match: (p) => p.startsWith('/community'),
    },
    {
      to: '/rankings',
      label: 'Rankings',
      icon: 'fa-ranking-star',
    },
  ]

  const secondary: NavItem[] = []
  if (user) {
    secondary.push({
      to: '/organiser',
      label: 'My events',
      icon: 'fa-calendar-check',
      match: (p) => p.startsWith('/organiser'),
    })
    if (user.role === 'ADMIN') {
      secondary.push({
        to: '/admin',
        label: 'Admin',
        icon: 'fa-shield-halved',
        match: (p) => p.startsWith('/admin'),
      })
    }
    // Profile is on the native tab bar — don't duplicate in the drawer
    if (!tabsVisible) {
      secondary.push({
        to: `/players/${user.id}`,
        label: 'Profile',
        icon: 'fa-user',
        match: (p) => p === `/players/${user.id}` || p.startsWith(`/players/${user.id}/`),
      })
    }
  }

  const showPrimaryInSidebar = !tabsVisible
  const sidebarOpen = desktop || open

  return (
    <>
      <button
        type="button"
        className={`app-sidebar-backdrop ${open && drawerMode ? 'is-open' : ''}`}
        aria-label="Close menu"
        tabIndex={-1}
        onClick={close}
      />

      <aside
        id={menuId}
        className={`app-sidebar ${sidebarOpen ? 'is-open' : ''}`}
        aria-label="App"
        aria-hidden={drawerMode ? !open : undefined}
        inert={drawerMode && !open ? true : undefined}
      >
        <div className="app-sidebar-head">
          <BrandLogo to={brandTo} className="app-sidebar-brand" size="sm" onClick={close} />
          {user && desktop ? (
            <div className="app-sidebar-bell">
              <NotificationsBell />
            </div>
          ) : null}
        </div>

        <nav className="app-sidebar-nav" aria-label="Main">
          {showPrimaryInSidebar &&
            primary.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `app-sidebar-link ${linkActive(pathname, item, isActive) ? 'is-active' : ''}`
                }
                onClick={close}
              >
                <i className={`fas ${item.icon}`} aria-hidden />
                <span>{item.label}</span>
              </NavLink>
            ))}

          {secondary.length > 0 && (
            <>
              {showPrimaryInSidebar && <p className="app-sidebar-label">Account</p>}
              {secondary.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `app-sidebar-link ${linkActive(pathname, item, isActive) ? 'is-active' : ''}`
                  }
                  onClick={close}
                >
                  <i className={`fas ${item.icon}`} aria-hidden />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}

          {!user && (
            <>
              <NavLink to="/login" className="app-sidebar-link" onClick={close}>
                <i className="fas fa-right-to-bracket" aria-hidden />
                <span>Log in</span>
              </NavLink>
              <Link to="/signup" className="app-sidebar-link" onClick={close}>
                <i className="fas fa-user-plus" aria-hidden />
                <span>Sign up</span>
              </Link>
            </>
          )}
        </nav>

        <div className="app-sidebar-foot">
          {user ? (
            <>
              <div className="app-sidebar-user">
                <strong>{user.full_name}</strong>
                <span>{user.email}</span>
              </div>
              <button type="button" className="app-sidebar-link" onClick={onLogout}>
                <i className="fas fa-arrow-right-from-bracket" aria-hidden />
                <span>Log out</span>
              </button>
            </>
          ) : (
            <Link to="/" className="app-sidebar-link" onClick={close}>
              <i className="fas fa-house" aria-hidden />
              <span>Home</span>
            </Link>
          )}
        </div>
      </aside>

      <header className="app-topbar">
        <button
          type="button"
          className="app-topbar-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          <i className={`fas ${open ? 'fa-times' : 'fa-bars'}`} />
        </button>
        <BrandLogo to={brandTo} className="app-topbar-brand" size="sm" onClick={close} />
        <div className="app-topbar-end">{user && !desktop ? <NotificationsBell /> : null}</div>
      </header>
    </>
  )
}
