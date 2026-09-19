import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { communityApi } from '../services/api'

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const friendReqQ = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user,
    staleTime: 30_000,
  })
  const incomingCount = (friendReqQ.data || []).filter((f) => f.direction === 'incoming').length

  useEffect(() => {
    document.body.classList.toggle('mobile-menu-open', open)
    return () => document.body.classList.remove('mobile-menu-open')
  }, [open])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) setOpen(false)
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
    navigate('/')
  }

  return (
    <header className={`app-nav ${open ? 'is-menu-open' : ''}`}>
      <Link to="/" className="app-nav-brand" onClick={close}>
        Student Padel Ireland
      </Link>
      <nav className={`app-nav-links ${open ? 'is-open' : ''}`}>
        <NavLink to="/tournaments" className={({ isActive }) => (isActive ? 'active' : '')} onClick={close}>
          Tournaments
        </NavLink>
        <NavLink to="/community" className={({ isActive }) => (isActive ? 'active' : '')} onClick={close}>
          Community
          {incomingCount > 0 && <span className="nav-badge">{incomingCount}</span>}
        </NavLink>
        <NavLink to="/rankings" className={({ isActive }) => (isActive ? 'active' : '')} onClick={close}>
          Rankings
        </NavLink>
        {user ? (
          <>
            {user.role === 'ADMIN' && (
              <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')} onClick={close}>
                Admin
              </NavLink>
            )}
            {(user.role === 'ORGANISER' || user.role === 'ADMIN') && (
              <NavLink to="/organiser" className={({ isActive }) => (isActive ? 'active' : '')} onClick={close}>
                Dashboard
              </NavLink>
            )}
            <NavLink to={`/players/${user.id}`} className={({ isActive }) => (isActive ? 'active' : '')} onClick={close}>
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
      <button
        type="button"
        className="app-nav-menu-btn"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`fas ${open ? 'fa-times' : 'fa-bars'}`} />
      </button>
    </header>
  )
}
