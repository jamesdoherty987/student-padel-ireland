import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, communityApi } from '../services/api'
import './Tournament.css'
import './Community.css'

export default function JoinCompetitionPage() {
  const { code = '' } = useParams()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const clean = code.trim().toUpperCase()

  const joinMut = useMutation({
    mutationFn: () => communityApi.joinByCode(clean),
    onSuccess: (res) => navigate(`/community/${res.data.slug}`, { replace: true }),
    onError: (e) => setError(apiErrorMessage(e)),
  })

  useEffect(() => {
    if (!loading && user && clean.length >= 6 && !joinMut.isPending && !joinMut.isSuccess && !error) {
      joinMut.mutate()
    }
  }, [loading, user, clean, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!user) {
    const next = encodeURIComponent(`/community/join/${clean}`)
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <h1 className="page-title">Join competition</h1>
          <p className="page-sub">Code {clean || '—'}</p>
          <p className="muted-note" style={{ marginBottom: 16 }}>
            Log in or sign up to join this private competition.
          </p>
          <div className="header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
        <h1 className="page-title">Join competition</h1>
        <p className="page-sub">Code {clean}</p>
        {error ? (
          <div className="empty-state">
            <p>{error}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
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
              <Link to="/community" className="btn btn-ghost">
                Back to community
              </Link>
            </div>
          </div>
        ) : (
          <p className="muted-note">Joining…</p>
        )}
      </main>
    </div>
  )
}
