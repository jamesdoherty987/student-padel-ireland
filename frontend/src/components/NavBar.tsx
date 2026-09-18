import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const onLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <header className="app-nav">
      <Link to="/" className="app-nav-brand">
        Student Padel Ireland
      </Link>
      <nav className="app-nav-links">
        <NavLink to="/tournaments" className={({ isActive }) => (isActive ? 'active' : '')}>
          Tournaments
        </NavLink>
        <NavLink to="/rankings" className={({ isActive }) => (isActive ? 'active' : '')}>
          Rankings
        </NavLink>
        {user ? (
          <>
            {(user.role === 'ORGANISER' || user.role === 'ADMIN') && (
              <NavLink to="/organiser" className={({ isActive }) => (isActive ? 'active' : '')}>
                Dashboard
              </NavLink>
            )}
            <span className="hide-mobile" style={{ color: 'var(--muted)', fontSize: '0.88rem', padding: '0 0.35rem' }}>
              {user.full_name.split(' ')[0]}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 40, padding: '0.4rem 0.85rem' }}
              onClick={onLogout}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <NavLink to="/login">Log in</NavLink>
            <Link to="/signup" className="btn btn-primary" style={{ minHeight: 40, padding: '0.4rem 1rem' }}>
              Join
            </Link>
          </>
        )}
      </nav>
    </header>
  )
}
