import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { ReactNode } from 'react'
import NavBar from './NavBar'

export function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode
  roles?: string[]
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page" style={{ paddingTop: '2rem' }}>
          <div className="skeleton" style={{ height: 28, width: '40%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </main>
      </div>
    )
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">{roles?.includes('ADMIN') && roles.length === 1 ? 'Admin access required' : 'Organiser access required'}</h1>
          <p className="page-sub">
            {roles?.includes('ADMIN') && roles.length === 1
              ? 'This area is for platform admins only.'
              : 'This area is for tournament organisers. Browse events or create an organiser account.'}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/tournaments" className="btn btn-primary">
              Browse tournaments
            </Link>
            <Link to="/signup?role=ORGANISER" className="btn btn-ghost">
              Become an organiser
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return <>{children}</>
}
