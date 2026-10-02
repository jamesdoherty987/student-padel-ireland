import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { HaveCodeButton } from '../components/JoinCodeModal'
import { cleanInviteCode, resolveInviteCode } from '../utils/inviteCode'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage } from '../services/api'
import './Tournament.css'
import './Community.css'

/**
 * Deep link / QR target for invite codes.
 * Bare /join redirects to tournaments with the join popup open - there is no Join code tab.
 */
export default function JoinByCodePage() {
  const { code = '' } = useParams()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [autoError, setAutoError] = useState('')
  const [autoStatus, setAutoStatus] = useState('')
  const clean = cleanInviteCode(code)
  const hasCodeParam = Boolean(code)

  useEffect(() => {
    if (!hasCodeParam || loading || !clean || clean.length < 6) return
    let cancelled = false
    setAutoError('')
    setAutoStatus('Looking up invite…')
    ;(async () => {
      try {
        const invite = await resolveInviteCode(clean)
        if (cancelled) return
        setAutoStatus(`Opening ${invite.name}…`)
        if (invite.kind === 'tournament') {
          if (user) navigate(invite.join_path, { replace: true })
          else navigate(`/login?next=${encodeURIComponent(invite.join_path)}`, { replace: true })
        } else {
          navigate(invite.join_path, { replace: true })
        }
      } catch (e) {
        if (!cancelled) {
          setAutoStatus('')
          setAutoError(apiErrorMessage(e, 'Invite code not found'))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasCodeParam, loading, clean, user, navigate])

  if (!hasCodeParam) {
    return <Navigate to="/tournaments?join=1" replace />
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page join-any-page">
        <h1 className="page-title">Joining…</h1>
        <p className="page-sub">Code {clean || '-'}</p>

        {clean.length >= 6 && !autoError && autoStatus && <p className="muted-note">{autoStatus}</p>}
        {autoError && (
          <div className="empty-state" style={{ padding: '1.25rem 0' }}>
            <p>{autoError}</p>
            <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              <HaveCodeButton className="btn btn-primary" initialCode={clean}>
                Try another code
              </HaveCodeButton>
              <Link to="/tournaments" className="btn btn-ghost">
                Browse tournaments
              </Link>
            </div>
          </div>
        )}
        {clean.length < 6 && (
          <div className="empty-state" style={{ padding: '1.25rem 0' }}>
            <p>That invite code looks incomplete.</p>
            <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              <HaveCodeButton className="btn btn-primary">Enter a code</HaveCodeButton>
              <Link to="/tournaments" className="btn btn-ghost">
                Browse tournaments
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
