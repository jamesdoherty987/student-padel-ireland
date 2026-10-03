import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isNativeApp } from '../native/platform'
import BrandLogo from './BrandLogo'
import NotificationsBell from './NotificationsBell'

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const native = isNativeApp()

  useEffect(() => {
    document.body.classList.toggle('mobile-menu-open', open)
    return () => document.body.classList.remove('mobile-menu-open')
  }, [open])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 1024) setOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  const brandTo = native ? (user ? '/tournaments' : '/welcome') : '/'

  return (
    <header className={`app-nav ${open ? 'is-menu-open' : ''} ${native ? 'is-native' : ''}`}>
      <BrandLogo to={brandTo} className="app-nav-brand" size="sm" onClick={close} />
      <div className="app-nav-end">
        <nav className={`app-nav-links ${open ? 'is-open' : ''}`}>
          <NavLink
            to="/tournaments"
            className={({ isActive }) => (isActive ? 'active' : '')}
            onClick={close}
          >
            Tournaments
          </NavLink>
          <NavLink
            to="/community"
            className={({ isActive }) => (isActive ? 'active' : '')}
            onClick={close}
          >
            Community
          </NavLink>
          <NavLink
            to="/rankings"
            className={({ isActive }) => (isActive ? 'active' : '')}
            onClick={close}
          >
            Rankings
          </NavLink>
          {user ? (
            <>
              {user.role === 'ADMIN' && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) => (isActive ? 'active' : '')}
                  onClick={close}
                >
                  Admin
                </NavLink>
              )}
              <NavLink
                to="/organiser"
                className={({ isActive }) => (isActive ? 'active' : '')}
                onClick={close}
              >
                My events
              </NavLink>
              <NavLink
                to={`/players/${user.id}`}
                className={({ isActive }) => (isActive ? 'active' : '')}
                onClick={close}
              >
                Profile
              </NavLink>
              <span className="app-nav-user">{user.full_name.split(' ')[0]}</span>
              <button type="button" className="btn btn-ghost app-nav-logout" onClick={onLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" onClick={close}>
                Log in
              </NavLink>
              <Link to="/signup" className="btn btn-primary app-nav-join" onClick={close}>
                Sign up
              </Link>
            </>
          )}
        </nav>
        {user && (
          <div className="app-nav-bell-slot">
            <NotificationsBell />
          </div>
        )}
        <button
          type="button"
          className="app-nav-menu-btn"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <i className={`fas ${open ? 'fa-times' : 'fa-bars'}`} />
        </button>
      </div>
    </header>
  )
}
