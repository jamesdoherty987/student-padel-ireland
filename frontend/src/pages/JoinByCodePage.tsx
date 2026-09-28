import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { JoinCodeBox, cleanInviteCode, resolveInviteCode } from '../components/JoinCodeBox'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage } from '../services/api'
import './Tournament.css'
import './Community.css'

/** Dedicated “paste any invite code” page — tournament or friend group. */
export default function JoinByCodePage() {
  const { code = '' } = useParams()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [autoError, setAutoError] = useState('')
  const [autoStatus, setAutoStatus] = useState('')
  const clean = cleanInviteCode(code)

  useEffect(() => {
    if (loading || !clean || clean.length < 6) return
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
  }, [loading, clean, user, navigate])

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page join-any-page">
        <h1 className="page-title">Join with a code</h1>
        <p className="page-sub">
          Paste the code your friend shared. It can be for a <strong>tournament</strong> or a{' '}
          <strong>community</strong> group — we’ll send you to the right place.
        </p>

        {clean.length >= 6 && !autoError && autoStatus && (
          <p className="muted-note" style={{ marginBottom: '1rem' }}>
            {autoStatus}
          </p>
        )}
        {autoError && (
          <div className="empty-state" style={{ padding: '1.25rem 0' }}>
            <p>{autoError}</p>
          </div>
        )}

        <JoinCodeBox
          initialCode={autoError ? clean : ''}
          title=""
          hint="Same box works on the Tournaments and Community tabs too."
          placeholder="e.g. EHWDZA78"
        />

        <div className="join-any-help">
          <h2>Quick guide</h2>
          <ul>
            <li>
              <strong>Tournaments</strong> — organised events with brackets (often a fee)
            </li>
            <li>
              <strong>Community</strong> — private friend groups and ladders
            </li>
          </ul>
          <p className="muted-note">Only have a code? Paste it above. You don’t need to guess the tab.</p>
        </div>
        <div className="header-actions" style={{ marginTop: '1.25rem' }}>
          <Link to="/tournaments" className="btn btn-ghost">
            Browse tournaments
          </Link>
          <Link to="/community" className="btn btn-ghost">
            Open community
          </Link>
        </div>
      </main>
    </div>
  )
}
