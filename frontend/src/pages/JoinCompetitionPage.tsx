import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { cleanInviteCode, resolveInviteCode } from '../components/JoinCodeBox'
import { apiErrorMessage, communityApi } from '../services/api'
import './Tournament.css'
import './Community.css'

/** Deep link /community/join/:code — also accepts tournament codes and redirects. */
export default function JoinCompetitionPage() {
  const { code = '' } = useParams()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Looking up invite…')
  const [attempt, setAttempt] = useState(0)
  const clean = cleanInviteCode(code)

  const joinMut = useMutation({
    mutationFn: () => communityApi.joinByCode(clean),
    onSuccess: (res) => navigate(`/community/${res.data.slug}`, { replace: true }),
    onError: (e) => setError(apiErrorMessage(e)),
  })

  useEffect(() => {
    if (loading || clean.length < 6) return
    let cancelled = false
    ;(async () => {
      setError('')
      setStatus('Looking up invite…')
      try {
        const invite = await resolveInviteCode(clean)
        if (cancelled) return
        if (invite.kind === 'tournament') {
          setStatus(`This is a tournament code. Opening ${invite.name}…`)
          const path = invite.join_path
          if (user) navigate(path, { replace: true })
          else navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true })
          return
        }
        if (!user) {
          navigate(`/login?next=${encodeURIComponent(`/community/join/${clean}`)}`, { replace: true })
          return
        }
        setStatus(`Joining ${invite.name}…`)
        joinMut.mutate()
      } catch (e) {
        if (!cancelled) setError(apiErrorMessage(e, 'Invite code not found'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loading, clean, user, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 100 }} />
        </main>
      </div>
    )
  }

  if (!user && !error) {
    const next = encodeURIComponent(`/community/join/${clean}`)
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <h1 className="page-title">Join with code</h1>
          <p className="page-sub">Code {clean || '—'}</p>
          <p className="muted-note" style={{ marginBottom: 16 }}>
            Log in or sign up to continue. Works for friend groups and tournaments.
          </p>
          <div className="header-actions">
            <Link to={`/login?next=${next}`} className="btn btn-primary">
              Log in
            </Link>
            <Link to={`/signup?next=${next}`} className="btn btn-ghost">
              Sign up
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <h1 className="page-title">Join with code</h1>
        <p className="page-sub">Code {clean}</p>
        {error ? (
          <div className="empty-state">
            <p>{error}</p>
            <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setError('')
                  setAttempt((n) => n + 1)
                }}
              >
                Retry
              </button>
              <Link to="/join" className="btn btn-ghost">
                Try another code
              </Link>
            </div>
          </div>
        ) : (
          <p className="muted-note">{status}</p>
        )}
      </main>
    </div>
  )
}
