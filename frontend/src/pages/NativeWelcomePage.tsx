import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isNativeApp } from '../native/platform'
import { setStatusBarForDarkScreen, setStatusBarForLightScreen } from '../native/statusBar'
import { useEffect } from 'react'
import './NativeWelcome.css'

/** Compact native launch screen — not the marketing website. */
export default function NativeWelcomePage() {
  const { user, loading } = useAuth()

  useEffect(() => {
    void setStatusBarForDarkScreen()
    return () => {
      void setStatusBarForLightScreen()
    }
  }, [])

  if (!isNativeApp()) {
    return <Navigate to="/" replace />
  }

  if (!loading && user) {
    return <Navigate to="/tournaments" replace />
  }

  return (
    <div className="native-welcome">
      <div className="native-welcome-bg" aria-hidden />
      <div className="native-welcome-inner">
        <p className="native-welcome-brand">Student Padel Ireland</p>
        <h1>Play. Score. Climb.</h1>
        <p className="native-welcome-sub">
          Join student tournaments, log community matches, and follow live scores across Ireland.
        </p>
        <div className="native-welcome-actions">
          <Link to="/tournaments" className="btn btn-primary btn-block">
            Browse events
          </Link>
          <Link to="/login" className="btn btn-ghost btn-block native-welcome-ghost">
            Log in
          </Link>
          <Link to="/signup" className="native-welcome-signup">
            Create account
          </Link>
        </div>
      </div>
    </div>
  )
}
