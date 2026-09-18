import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, platformApi, tournamentApi, type RegistrationConfirm } from '../services/api'
import { formatMoney } from '../utils/format'
import './Tournament.css'

function ConfirmView({ data }: { data: RegistrationConfirm }) {
  const slug = data.tournament?.slug
  return (
    <div>
      <NavBar />
      <main className="page confirm-page">
        <p className="eyebrow">Student Padel Ireland</p>
        <h1 className="page-title">Registration confirmed</h1>
        <p className="confirm-tour">{data.tournament?.name}</p>
        <div className="confirm-box">
          <div>
            <span>Team</span>
            <strong>{data.team_name}</strong>
          </div>
          <div>
            <span>Players</span>
            <strong>
              {data.players.map((p) => (
                <span key={p} style={{ display: 'block' }}>
                  {p}
                </span>
              ))}
            </strong>
          </div>
          <div>
            <span>Payment</span>
            <strong className={data.status === 'PAID' ? 'paid' : ''}>
              {formatMoney(data.amount_cents, data.currency)} {data.status}
            </strong>
          </div>
        </div>
        {slug && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Link to={`/t/${slug}/live`} className="btn btn-primary btn-block">
              Go to my matches
            </Link>
            <Link to={`/t/${slug}`} className="btn btn-ghost btn-block">
              Tournament page
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

export default function JoinTournamentPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')
  const registrationId = params.get('registration_id')
  const isConfirmRoute = window.location.pathname.includes('/confirmed') || !!sessionId

  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const { data: tournament, isLoading: tLoading, isError: tError } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: async () => (await tournamentApi.get(slug)).data,
    enabled: !!slug,
  })

  const { data: universities = [] } = useQuery({
    queryKey: ['universities'],
    queryFn: async () => (await platformApi.universities()).data,
  })

  const { data: stripeConfirm, isLoading: confirming, isError: confirmError } = useQuery({
    queryKey: ['payment-confirm', sessionId, registrationId],
    queryFn: async () => {
      if (sessionId) return (await tournamentApi.confirmPaymentSession(sessionId)).data
      if (registrationId) return (await tournamentApi.getRegistration(registrationId)).data
      throw new Error('Missing session')
    },
    enabled: isConfirmRoute && !!user && (!!sessionId || !!registrationId),
    retry: 2,
  })

  const [form, setForm] = useState({
    team_name: '',
    partner_name: '',
    partner_email: '',
    phone: '',
    university_id: '',
    student_number: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) {
      setForm((f) => ({
        ...f,
        phone: f.phone || user.phone || '',
        university_id: f.university_id || user.university_id || '',
        student_number: f.student_number || user.student_number || '',
      }))
    }
  }, [user])

  if (authLoading || (isConfirmRoute && confirming)) {
    return (
      <div>
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '50%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 160 }} />
        </main>
      </div>
    )
  }

  if (isConfirmRoute && stripeConfirm) {
    return <ConfirmView data={stripeConfirm} />
  }

  if (isConfirmRoute && confirmError) {
    return (
      <div>
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Confirming payment…</h1>
          <p className="page-sub">
            We couldn&apos;t verify this payment yet. If you were charged, your registration will appear shortly.
          </p>
          <Link to={`/t/${slug}`} className="btn btn-primary">
            Back to tournament
          </Link>
        </main>
      </div>
    )
  }

  if (!user) {
    const next = encodeURIComponent(`/t/${slug}/join`)
    return (
      <div>
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Join tournament</h1>
          <p className="page-sub">Log in to register your team and pay the entry fee.</p>
          <Link to={`/login?next=${next}`} className="btn btn-primary">
            Log in to join
          </Link>
        </main>
      </div>
    )
  }

  if (tLoading) {
    return (
      <div>
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '60%' }} />
        </main>
      </div>
    )
  }

  if (tError || !tournament) {
    return (
      <div>
        <NavBar />
        <main className="page empty-state">
          <p>Tournament not found.</p>
          <Link to="/tournaments" className="btn btn-ghost" style={{ marginTop: 12 }}>
            Browse tournaments
          </Link>
        </main>
      </div>
    )
  }

  if (tournament.status !== 'REGISTRATION_OPEN') {
    return (
      <div>
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">{tournament.name}</h1>
          <p className="page-sub">Registration is not open for this tournament.</p>
          <Link to={`/t/${tournament.slug}`} className="btn btn-primary">
            View tournament
          </Link>
        </main>
      </div>
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data } = await tournamentApi.register(tournament.id, {
        tournament_id: tournament.id,
        ...form,
        university_id: form.university_id || null,
      })
      if (data.checkout_url) {
        window.location.href = data.checkout_url
        return
      }
      navigate(`/t/${slug}/confirmed?registration_id=${data.registration_id}`, { replace: true })
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <NavBar />
      <main className="page">
        <h1 className="page-title">Join {tournament.name}</h1>
        <p className="page-sub">
          Entry {formatMoney(tournament.entry_fee_cents, tournament.currency)} · Two players per team ·{' '}
          {tournament.registered_teams}/{tournament.max_teams} registered
        </p>
        <form className="join-form" onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">Your name</label>
            <input className="form-input" value={user.full_name} disabled />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" value={user.email} disabled />
          </div>
          <div className="form-group">
            <label className="form-label">Team name</label>
            <input
              className="form-input"
              value={form.team_name}
              onChange={(e) => setForm({ ...form, team_name: e.target.value })}
              placeholder="UL Padel 1"
              required
              minLength={2}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Partner name</label>
            <input
              className="form-input"
              value={form.partner_name}
              onChange={(e) => setForm({ ...form, partner_name: e.target.value })}
              required
              minLength={2}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Partner email</label>
            <input
              className="form-input"
              type="email"
              value={form.partner_email}
              onChange={(e) => setForm({ ...form, partner_email: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input
              className="form-input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">University</label>
            <select
              className="form-select"
              value={form.university_id}
              onChange={(e) => setForm({ ...form, university_id: e.target.value })}
              required
            >
              <option value="">Select university…</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Student number (optional)</label>
            <input
              className="form-input"
              value={form.student_number}
              onChange={(e) => setForm({ ...form, student_number: e.target.value })}
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={loading || tLoading}>
            {loading ? 'Processing…' : `Pay ${formatMoney(tournament.entry_fee_cents, tournament.currency)}`}
          </button>
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => navigate(`/t/${slug}`)}>
            Cancel
          </button>
        </form>
      </main>
    </div>
  )
}
