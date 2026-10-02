import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { hapticSuccess } from '../native/haptics'
import { isNativeApp } from '../native/platform'
import { openExternalUrl, whenExternalBrowserCloses } from '../native/shell'
import {
  apiErrorMessage,
  apiErrorStatus,
  communityApi,
  platformApi,
  tournamentApi,
  type RegistrationConfirm,
} from '../services/api'
import { formatMoney, isPastCalendarDate } from '../utils/format'
import './Tournament.css'
import './Community.css'

function ConfirmView({ data }: { data: RegistrationConfirm }) {
  const slug = data.tournament?.slug
  const paid = data.status === 'PAID'
  const singles = data.tournament?.play_format === 'SINGLES'

  useEffect(() => {
    if (paid) void hapticSuccess()
  }, [paid])

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page confirm-page">
        <BrandLogo to="/tournaments" className="confirm-brand" size="sm" />
        <h1 className="page-title">{paid ? 'Registration confirmed' : 'Registration received'}</h1>
        <p className="confirm-tour">{data.tournament?.name}</p>
        <div className="confirm-box">
          <div>
            <span>{singles ? 'Entry' : 'Team'}</span>
            <strong>{data.team_name}</strong>
          </div>
          <div>
            <span>{singles ? 'Player' : 'Players'}</span>
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
            <strong className={paid ? 'paid' : ''}>
              {formatMoney(data.amount_cents, data.currency)} · {data.status}
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
  const paymentCancelled = params.get('cancelled') === '1'
  const isConfirmRoute = window.location.pathname.includes('/confirmed') || !!sessionId
  const hasConfirmParams = !!sessionId || !!registrationId

  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [paymentNote, setPaymentNote] = useState(
    paymentCancelled ? 'Payment was cancelled. You can try again when ready.' : '',
  )

  const { data: tournament, isLoading: tLoading, isError: tError } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: async () => (await tournamentApi.get(slug)).data,
    enabled: !!slug && !isConfirmRoute,
  })

  const { data: universities = [] } = useQuery({
    queryKey: ['universities'],
    queryFn: async () => (await platformApi.universities()).data,
    enabled: !isConfirmRoute,
  })
  const { data: publicConfig } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => (await platformApi.publicConfig()).data,
    enabled: !isConfirmRoute,
    staleTime: 60_000,
  })
  const { data: friends = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user && !isConfirmRoute,
  })
  const friendPartners = useMemo(
    () => friends.filter((f) => f.direction === 'friend'),
    [friends],
  )

  const {
    data: stripeConfirm,
    isLoading: confirming,
    isError: confirmError,
    error: confirmErr,
  } = useQuery({
    queryKey: ['payment-confirm', sessionId, registrationId],
    queryFn: async () => {
      if (sessionId) return (await tournamentApi.confirmPaymentSession(sessionId)).data
      if (registrationId) return (await tournamentApi.getRegistration(registrationId)).data
      throw new Error('Missing session')
    },
    enabled: isConfirmRoute && !!user && hasConfirmParams,
    retry: 2,
  })

  const [form, setForm] = useState({
    team_name: '',
    partner_name: '',
    partner_email: '',
    partner_user_id: '',
    phone: '',
    university_id: '',
    student_number: '',
  })
  const [partnerMode, setPartnerMode] = useState<'friend' | 'email'>('friend')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const checkoutDisposeRef = useRef<(() => void) | null>(null)
  const profileDefaultsApplied = useRef(false)

  useEffect(() => {
    return () => {
      checkoutDisposeRef.current?.()
      checkoutDisposeRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!user || profileDefaultsApplied.current) return
    profileDefaultsApplied.current = true
    setForm((f) => ({
      ...f,
      phone: f.phone || user.phone || '',
      university_id: f.university_id || user.university_id || '',
      student_number: f.student_number || user.student_number || '',
    }))
  }, [user])

  useEffect(() => {
    if (friendPartners.length === 0 && partnerMode === 'friend') {
      setPartnerMode('email')
    }
  }, [friendPartners.length, partnerMode])

  if (authLoading || (isConfirmRoute && hasConfirmParams && confirming)) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '50%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 160 }} />
        </main>
      </div>
    )
  }

  if (isConfirmRoute && !hasConfirmParams) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Missing payment details</h1>
          <p className="page-sub">
            This confirmation link is incomplete. Open the tournament page and try again.
          </p>
          <Link to={slug ? `/t/${slug}` : '/tournaments'} className="btn btn-primary">
            {slug ? 'Back to tournament' : 'Browse tournaments'}
          </Link>
        </main>
      </div>
    )
  }

  if (isConfirmRoute && stripeConfirm) {
    return <ConfirmView data={stripeConfirm} />
  }

  if (isConfirmRoute && confirmError) {
    const status = apiErrorStatus(confirmErr)
    const title =
      status === 403 ? 'Wrong account' : status === 404 ? 'Registration not found' : 'Couldn’t confirm payment'
    const copy =
      status === 403
        ? 'This registration belongs to another account. Log in with the email used at checkout.'
        : status === 404
          ? 'We could not find this registration. If you just paid, wait a moment and refresh.'
          : "We couldn't verify this payment yet. If you were charged, your registration will appear shortly."

    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{copy}</p>
          <Link to={slug ? `/t/${slug}` : '/tournaments'} className="btn btn-primary">
            Back to tournament
          </Link>
        </main>
      </div>
    )
  }

  if (isConfirmRoute && hasConfirmParams) {
    if (!user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      return (
        <div className="app-shell">
          <NavBar />
          <main className="page empty-state">
            <h1 className="page-title">Confirm registration</h1>
            <p className="page-sub">Log in with the account used at checkout to see your confirmation.</p>
            <Link to={`/login?next=${next}`} className="btn btn-primary">
              Log in
            </Link>
          </main>
        </div>
      )
    }
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '50%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 160 }} />
        </main>
      </div>
    )
  }

  if (!user) {
    const next = encodeURIComponent(`/t/${slug}/join`)
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Join tournament</h1>
          <p className="page-sub">Create an account or log in to register your team.</p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link to={`/signup?next=${next}`} className="btn btn-primary">
              Sign up
            </Link>
            <Link to={`/login?next=${next}`} className="btn btn-ghost">
              Log in
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (tLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '60%' }} />
        </main>
      </div>
    )
  }

  if (tError || !tournament) {
    return (
      <div className="app-shell">
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
      <div className="app-shell">
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

  const deadlineGone = isPastCalendarDate(tournament.registration_deadline)

  if (deadlineGone) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">{tournament.name}</h1>
          <p className="page-sub">The registration deadline has passed.</p>
          <Link to={`/t/${tournament.slug}`} className="btn btn-primary">
            View tournament
          </Link>
        </main>
      </div>
    )
  }

  const isFull = tournament.registered_teams >= tournament.max_teams

  const singles = tournament.play_format === 'SINGLES'
  const entryNoun = singles ? 'players' : 'doubles teams'

  if (isFull) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">{tournament.name}</h1>
          <p className="page-sub">
            This tournament is full ({tournament.max_teams} {entryNoun}). Check the event page in case a spot opens.
          </p>
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
    setPaymentNote('')
    let holdLoadingForCheckout = false

    if (!singles) {
      const partnerFromFriend =
        partnerMode === 'friend' ? friendPartners.find((f) => f.user_id === form.partner_user_id) : null

      if (partnerMode === 'friend' && !partnerFromFriend) {
        setError('Pick a partner from your friends, or switch to email')
        setLoading(false)
        return
      }

      if (partnerMode === 'email') {
        if (!form.partner_email.trim() || form.partner_name.trim().length < 2) {
          setError('Enter your partner name and email')
          setLoading(false)
          return
        }
        if (form.partner_email.trim().toLowerCase() === user.email.toLowerCase()) {
          setError('Partner email must be different from yours')
          setLoading(false)
          return
        }
      }
    }

    try {
      const payload: Record<string, unknown> = {
        tournament_id: tournament.id,
        team_name: form.team_name.trim() || user.full_name,
        phone: form.phone || null,
        university_id: form.university_id || null,
        student_number: form.student_number || null,
      }
      if (!singles) {
        const partnerFromFriend =
          partnerMode === 'friend' ? friendPartners.find((f) => f.user_id === form.partner_user_id) : null
        if (partnerFromFriend) {
          payload.partner_user_id = partnerFromFriend.user_id
          payload.partner_name = partnerFromFriend.full_name
          payload.partner_email = null
        } else {
          payload.partner_name = form.partner_name
          payload.partner_email = form.partner_email
        }
      }

      const { data } = await tournamentApi.register(tournament.id, payload)
      if (data.checkout_url) {
        if (isNativeApp()) {
          // Stripe leaves the WebView. On browser close, verify payment — do not assume success.
          const regId = data.registration_id
          holdLoadingForCheckout = true
          checkoutDisposeRef.current?.()
          const dispose = await whenExternalBrowserCloses(() => {
            checkoutDisposeRef.current = null
            void (async () => {
              try {
                const { data: reg } = await tournamentApi.getRegistration(regId)
                if (reg.status === 'PAID') {
                  navigate(`/t/${slug}/confirmed?registration_id=${regId}`, { replace: true })
                  return
                }
              } catch {
                /* fall through */
              }
              setPaymentNote(
                'Payment was not completed. If you paid, open My matches or try confirming again shortly.',
              )
              setLoading(false)
            })()
          })
          checkoutDisposeRef.current = dispose
          try {
            await openExternalUrl(data.checkout_url)
          } catch {
            dispose()
            checkoutDisposeRef.current = null
            holdLoadingForCheckout = false
            setError('Could not open payment page')
          }
          return
        }
        window.location.href = data.checkout_url
        return
      }
      navigate(`/t/${slug}/confirmed?registration_id=${data.registration_id}`, { replace: true })
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Registration failed'))
    } finally {
      if (!holdLoadingForCheckout) setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <h1 className="page-title">Join {tournament.name}</h1>
        <p className="page-sub">
          {singles ? 'Singles' : 'Doubles'} · Entry{' '}
          {formatMoney(tournament.entry_fee_cents, tournament.currency)} per player ·{' '}
          {tournament.registered_teams}/{tournament.max_teams} {singles ? 'players' : 'doubles'} registered
        </p>
        {paymentNote && <p className="auth-error" style={{ marginBottom: '1rem' }}>{paymentNote}</p>}
        <form className="join-form" onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="join-name">
              Your name
            </label>
            <input id="join-name" className="form-input" value={user.full_name} disabled />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="join-email">
              Email
            </label>
            <input id="join-email" className="form-input" value={user.email} disabled />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="join-team">
              {singles ? 'Entry name' : 'Team name'}
            </label>
            <input
              id="join-team"
              className="form-input"
              value={form.team_name}
              onChange={(e) => setForm({ ...form, team_name: e.target.value })}
              placeholder={singles ? user.full_name : 'UL Padel 1'}
              required
              minLength={2}
            />
          </div>
          {!singles && (
          <div className="form-group">
            <label className="form-label" id="join-partner-label">
              Partner
            </label>
            <div className="partner-mode-row">
              <button
                type="button"
                className={`filter-chip ${partnerMode === 'friend' ? 'on' : ''}`}
                onClick={() => setPartnerMode('friend')}
                disabled={friendPartners.length === 0}
              >
                Friend
              </button>
              <button
                type="button"
                className={`filter-chip ${partnerMode === 'email' ? 'on' : ''}`}
                onClick={() => setPartnerMode('email')}
              >
                Email
              </button>
            </div>
            {partnerMode === 'friend' ? (
              <>
                <select
                  id="join-partner-friend"
                  className="form-select"
                  aria-labelledby="join-partner-label"
                  value={form.partner_user_id}
                  onChange={(e) => setForm({ ...form, partner_user_id: e.target.value })}
                  required
                >
                  <option value="">Select a friend</option>
                  {friendPartners.map((f) => (
                    <option key={f.user_id} value={f.user_id}>
                      {f.full_name}
                      {f.university_short ? ` (${f.university_short})` : ''}
                    </option>
                  ))}
                </select>
                {friendPartners.length === 0 && (
                  <p className="muted-note">
                    No friends yet. Add friends in Community, or use email.
                  </p>
                )}
              </>
            ) : (
              <>
                <input
                  id="join-partner-name"
                  className="form-input"
                  aria-label="Partner name"
                  value={form.partner_name}
                  onChange={(e) => setForm({ ...form, partner_name: e.target.value })}
                  placeholder="Partner name"
                  required
                  minLength={2}
                  style={{ marginBottom: 8 }}
                />
                <input
                  id="join-partner-email"
                  className="form-input"
                  type="email"
                  aria-label="Partner email"
                  value={form.partner_email}
                  onChange={(e) => setForm({ ...form, partner_email: e.target.value })}
                  placeholder="Partner email"
                  required
                />
                <p className="muted-note">Use the email they signed up with if they already have an account.</p>
              </>
            )}
          </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="join-phone">
              Phone
            </label>
            <input
              id="join-phone"
              className="form-input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              autoComplete="tel"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="join-uni">
              University
            </label>
            <select
              id="join-uni"
              className="form-select"
              value={form.university_id}
              onChange={(e) => setForm({ ...form, university_id: e.target.value })}
              required
            >
              <option value="">Select university</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="join-student">
              Student number (optional)
            </label>
            <input
              id="join-student"
              className="form-input"
              value={form.student_number}
              onChange={(e) => setForm({ ...form, student_number: e.target.value })}
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          {publicConfig?.demo_payments && (
            <p className="muted-note">Demo checkout. No card will be charged.</p>
          )}
          <button className="btn btn-primary btn-block" disabled={loading || tLoading}>
            {loading
              ? 'Processing...'
              : publicConfig?.demo_payments
                ? `Confirm ${formatMoney(tournament.entry_fee_cents, tournament.currency)} (demo)`
                : `Pay ${formatMoney(tournament.entry_fee_cents, tournament.currency)}`}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => navigate(`/t/${slug}`)}
          >
            Cancel
          </button>
        </form>
      </main>
    </div>
  )
}
