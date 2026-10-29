import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isNativeApp } from '../native/platform'
import { homeForRole } from '../utils/navigation'

/**
 * Legacy /welcome route - redirects into login (or role home).
 * Kept so old deep links / bookmarks do not 404.
 */
export default function NativeWelcomePage() {
  const { user, loading } = useAuth()

  if (!isNativeApp()) {
    return <Navigate to="/" replace />
  }

  if (loading) {
    return (
      <div className="route-fallback" aria-busy="true">
        <div className="skeleton" style={{ width: 'min(16rem, 70%)', height: 22, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: 'min(22rem, 90%)', height: 14 }} />
        <span className="visually-hidden">Loading</span>
      </div>
    )
  }

  if (user) {
    return <Navigate to={homeForRole(user.role)} replace />
  }

  return <Navigate to="/login" replace />
}
