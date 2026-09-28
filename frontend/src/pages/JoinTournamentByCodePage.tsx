import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { cleanInviteCode, resolveInviteCode } from '../components/JoinCodeBox'
import { apiErrorMessage } from '../services/api'
import './Tournament.css'

/** Deep link /t/join/:code — also accepts community codes and redirects. */
export default function JoinTournamentByCodePage() {
  const { code = '' } = useParams()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const clean = cleanInviteCode(code)

  useEffect(() => {
    if (loading || !clean || clean.length < 6) return
    let cancelled = false
    ;(async () => {
      try {
        const invite = await resolveInviteCode(clean)
        if (cancelled) return
        if (invite.kind === 'competition') {
          navigate(invite.join_path, { replace: true })
          return
        }
        if (user) {
          navigate(invite.join_path, { replace: true })
        } else {
          navigate(`/login?next=${encodeURIComponent(invite.join_path)}`, { replace: true })
        }
      } catch (e) {
        if (!cancelled) setError(apiErrorMessage(e, 'Invite code not found'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loading, clean, user, navigate])

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <h1 className="page-title">Join with code</h1>
        <p className="page-sub">Code {clean || '—'}</p>
        {error ? (
          <div className="empty-state">
            <p>{error}</p>
            <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              <Link to="/join" className="btn btn-primary">
                Try another code
              </Link>
              <Link to="/tournaments" className="btn btn-ghost">
                Browse tournaments
              </Link>
            </div>
          </div>
        ) : (
          <p className="muted-note">Looking up invite…</p>
        )}
      </main>
    </div>
  )
}
