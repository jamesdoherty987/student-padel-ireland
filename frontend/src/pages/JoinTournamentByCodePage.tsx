import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { HaveCodeButton } from '../components/JoinCodeModal'
import { useAuth } from '../context/AuthContext'
import { cleanInviteCode, resolveInviteCode } from '../utils/inviteCode'
import { apiErrorMessage } from '../services/api'
import './Tournament.css'

/** Deep link /t/join/:code - also accepts community codes and redirects. */
export default function JoinTournamentByCodePage() {
  const { code = '' } = useParams()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const clean = cleanInviteCode(code)
  const incomplete = clean.length > 0 && clean.length < 6

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

  const showError = error || incomplete || !clean

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <h1 className="page-title">Join with code</h1>
        <p className="page-sub">Code {clean || '-'}</p>
        {showError ? (
          <div className="empty-state">
            <p>
              {incomplete || !clean
                ? 'That invite code looks incomplete. Codes are usually 8 characters.'
                : error}
            </p>
            <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              <HaveCodeButton className="btn btn-primary" initialCode={clean}>
                Enter a code
              </HaveCodeButton>
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
