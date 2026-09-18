import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { ReactNode } from 'react'

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
      <div className="page" style={{ paddingTop: '3rem' }}>
        <div className="skeleton" style={{ height: 28, width: '40%', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    )
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/tournaments" replace />
  }

  return <>{children}</>
}
