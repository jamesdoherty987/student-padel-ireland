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
    const adminOnly = roles.includes('ADMIN') && roles.length === 1
    // Players who land on /admin (old links, bookmarks) should host privately — not hit a wall.
    if (adminOnly && location.pathname.startsWith('/admin')) {
      return <Navigate to="/tournaments?create=1" replace />
    }
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Access required</h1>
          <p className="page-sub">You do not have permission to view this page.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/tournaments?create=1" className="btn btn-primary">
              Host a private event
            </Link>
            <Link to="/tournaments" className="btn btn-ghost">
              Browse tournaments
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return <>{children}</>
}
