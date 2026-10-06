import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import LeaveTournamentButton from '../components/LeaveTournamentButton'
import NavBar from '../components/NavBar'
import SearchableSelect from '../components/SearchableSelect'
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
import { formatMoney, formatPerPlayerFee, isPastCalendarDate, tournamentFormatSummary } from '../utils/format'
import './Tournament.css'

function paymentLabel(status: string) {
  if (status === 'PAID') return 'Paid'
  if (status === 'PENDING') return 'Awaiting payment'
  return status.replace(/_/g, ' ')
}

function ConfirmView({ data }: { data: RegistrationConfirm }) {
  const navigate = useNavigate()
  const slug = data.tournament?.slug
  const tournamentId = data.tournament?.id
  const paid = data.status === 'PAID'
  const pending = data.status === 'PENDING'
  const isCaptain = data.slot == null || data.slot === 1
  const singles = data.tournament?.play_format === 'SINGLES'
  const canLeave = !!data.can_leave

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
              {data.players.map((p, i) => (
                <span key={`${p}-${i}`} style={{ display: 'block' }}>
                  {p}
                </span>
              ))}
            </strong>
          </div>
          <div>
            <span>Payment</span>
            <strong className={paid ? 'paid' : ''}>
              {formatMoney(data.amount_cents, data.currency)} · {paymentLabel(data.status)}
            </strong>
          </div>
        </div>
        {slug && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {paid ? (
              <Link to={`/t/${slug}/live`} className="btn btn-primary btn-block">
                Go to my matches
              </Link>
            ) : isCaptain ? (
              <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block">
                Complete payment
              </Link>
            ) : (
              <p className="muted-note">
                You’re listed as a partner. Your teammate needs to finish payment — or cancel the team
                entry below if you want out.
              </p>
            )}
            <Link to={`/t/${slug}`} className="btn btn-ghost btn-block">
              Tournament page
            </Link>
            {pending && canLeave && tournamentId && (
              <LeaveTournamentButton
                tournamentId={tournamentId}
                slug={slug}
                paymentStatus={data.status}
                teamName={data.team_name}
                singles={singles}
                className="btn btn-ghost btn-block"
                onLeft={() => navigate(`/t/${slug}`, { replace: true })}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

type MyTeamInfo = {
  id: string
  name: string
  payment_status?: string | null
  slot?: number | null
  players?: string[]
  partner_user_id?: string | null
  partner_name?: string | null
  partner_email?: string | null
  can_leave?: boolean
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

  const { data: playerView, isLoading: pvLoading } = useQuery({
    queryKey: ['player-view', slug],
    queryFn: async () => (await tournamentApi.playerView(slug)).data,
    enabled: !!slug && !!user && !isConfirmRoute,
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
  const { data: friends = [], isFetched: friendsFetched } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user && !isConfirmRoute,
  })

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
      team_name: f.team_name || user.full_name || '',
    }))
  }, [user])

  const myTeamEarly = (playerView?.my_team || null) as MyTeamInfo | null
  const resumePartnerId = myTeamEarly?.partner_user_id || ''
  const enteredUserIds = useMemo(() => {
    const raw = (playerView as { entered_user_ids?: string[] } | undefined)?.entered_user_ids
    return new Set(raw || [])
  }, [playerView])

  const friendPartners = useMemo(() => {
    const base = friends.filter((f) => {
      if (f.direction !== 'friend') return false
      // Allow the partner already on your pending team when resuming checkout
      if (resumePartnerId && f.user_id === resumePartnerId) return true
      return !enteredUserIds.has(f.user_id)
    })
    // Email-invited partner on a pending team may not be in friends yet
    if (
      resumePartnerId &&
      myTeamEarly?.partner_name &&
      !base.some((f) => f.user_id === resumePartnerId)
    ) {
      return [
        {
          id: `resume-${resumePartnerId}`,
          user_id: resumePartnerId,
          full_name: myTeamEarly.partner_name,
          university_short: null,
          points: 0,
          status: 'ACCEPTED',
          direction: 'friend' as const,
          created_at: '',
        },
        ...base,
      ]
    }
    return base
  }, [friends, enteredUserIds, resumePartnerId, myTeamEarly?.partner_name])

  const friendsBusyElsewhere = useMemo(() => {
    return friends.filter(
      (f) =>
        f.direction === 'friend' &&
        enteredUserIds.has(f.user_id) &&
        f.user_id !== resumePartnerId,
    )
  }, [friends, enteredUserIds, resumePartnerId])

  const resumeDefaultsApplied = useRef(false)
  useEffect(() => {
    if (!myTeamEarly || myTeamEarly.payment_status !== 'PENDING' || myTeamEarly.slot !== 1) return
    if (resumeDefaultsApplied.current) return
    resumeDefaultsApplied.current = true
    const partnerOnFriends = !!myTeamEarly.partner_user_id && friendPartners.some((f) => f.user_id === myTeamEarly.partner_user_id)
    setForm((f) => ({
      ...f,
      team_name: myTeamEarly.name || f.team_name,
      partner_user_id: myTeamEarly.partner_user_id || f.partner_user_id,
      partner_name: myTeamEarly.partner_name || f.partner_name,
      partner_email: myTeamEarly.partner_email || f.partner_email,
    }))
    if (myTeamEarly.partner_user_id && (partnerOnFriends || !friendsFetched)) {
      setPartnerMode('friend')
    } else if (myTeamEarly.partner_email || myTeamEarly.partner_name) {
      setPartnerMode('email')
    }
  }, [myTeamEarly, friendPartners, friendsFetched])

  useEffect(() => {
    if (!friendsFetched) return
    // Keep friend mode while resuming with a saved partner id
    if (form.partner_user_id) return
    if (friendPartners.length === 0 && partnerMode === 'friend') {
      setPartnerMode('email')
    }
  }, [friendsFetched, friendPartners.length, partnerMode, form.partner_user_id])

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
          <p className="page-sub">Create an account or log in to register.</p>
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

  if (tLoading || pvLoading) {
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

  const myTeam = (playerView?.my_team || null) as MyTeamInfo | null
  const myPayment = myTeam?.payment_status
  const mySlot = myTeam?.slot ?? null
  const singles = tournament.play_format === 'SINGLES'

  if (myTeam && myPayment === 'PAID') {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">You’re already in</h1>
          <p className="page-sub">
            {myTeam.name}
            {myTeam.players?.length ? ` · ${myTeam.players.join(' / ')}` : ''}
          </p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link to={`/t/${tournament.slug}/live`} className="btn btn-primary">
              My matches
            </Link>
            <Link to={`/t/${tournament.slug}`} className="btn btn-ghost">
              Tournament page
            </Link>
          </div>
          {myTeam.can_leave && (
            <>
              <p className="muted-note entry-leave-note">
                Need to pull out before the event starts? You can leave below. Fees aren’t refunded
                automatically — message the organiser if you need one.
              </p>
              <LeaveTournamentButton
                tournamentId={tournament.id}
                slug={tournament.slug}
                paymentStatus={myPayment}
                teamName={myTeam.name}
                singles={singles}
                className="btn btn-ghost"
                onLeft={() => navigate(`/t/${tournament.slug}`, { replace: true })}
              />
            </>
          )}
        </main>
      </div>
    )
  }

  if (myTeam && myPayment === 'PENDING' && mySlot !== 1) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">You’re listed as a partner</h1>
          <p className="page-sub">
            You’re already on <strong>{myTeam.name}</strong>
            {myTeam.players?.length ? ` (${myTeam.players.join(' / ')})` : ''}. Your teammate needs to finish
            payment — you can’t enter this event again separately unless you leave first.
          </p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link to={`/t/${tournament.slug}`} className="btn btn-primary">
              View tournament
            </Link>
            {myTeam.can_leave && (
              <LeaveTournamentButton
                tournamentId={tournament.id}
                slug={tournament.slug}
                paymentStatus={myPayment}
                teamName={myTeam.name}
                singles={singles}
                className="btn btn-ghost"
                onLeft={() => navigate(`/t/${tournament.slug}`, { replace: true })}
              />
            )}
          </div>
        </main>
      </div>
    )
  }

  const resumingPending = !!(myTeam && myPayment === 'PENDING' && mySlot === 1)
  const deadlineGone = isPastCalendarDate(tournament.registration_deadline)
  const isFull = tournament.registered_teams >= tournament.max_teams
  const entryNoun = singles ? 'players' : 'doubles teams'
  const eventStarted =
    tournament.status === 'LIVE' ||
    tournament.status === 'COMPLETED' ||
    tournament.status === 'CANCELLED'

  if (!resumingPending && tournament.status !== 'REGISTRATION_OPEN') {
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

  if (!resumingPending && deadlineGone) {
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

  if (!resumingPending && isFull) {
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

  if (resumingPending && eventStarted) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Can’t finish payment</h1>
          <p className="page-sub">
            This event has already started. Cancel your pending entry below if you still need to clear it.
          </p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link to={`/t/${tournament.slug}`} className="btn btn-primary">
              View tournament
            </Link>
            {myTeam?.can_leave && (
              <LeaveTournamentButton
                tournamentId={tournament.id}
                slug={tournament.slug}
                paymentStatus={myPayment}
                teamName={myTeam.name}
                singles={singles}
                className="btn btn-ghost"
                onLeft={() => navigate(`/t/${tournament.slug}`, { replace: true })}
              />
            )}
          </div>
        </main>
      </div>
    )
  }
  const teamFee = formatMoney(tournament.entry_fee_cents, tournament.currency)
  const perPlayer = formatPerPlayerFee(
    tournament.entry_fee_cents,
    tournament.currency,
    tournament.play_format,
  ).replace('/', ' per ')

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
          setError('Enter your partner’s name and email')
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
          {tournamentFormatSummary(tournament.play_format, tournament.format)} · {perPlayer}
          {!singles ? ` · team fee ${teamFee}` : ''}
        </p>

        {resumingPending && (
          <p className="form-success" style={{ marginBottom: '1rem' }}>
            You already started <strong>{myTeam?.name}</strong>. Update details if needed and finish
            payment
            {tournament.status !== 'REGISTRATION_OPEN' || deadlineGone || isFull
              ? ' — registration may be closed or full for new entries, but you can still complete yours if a spot remains.'
              : '.'}
          </p>
        )}

        {!singles && (
          <p className="muted-note join-pay-note">
            You pay the full team entry of <strong>{teamFee}</strong>. Your partner is not charged separately.
          </p>
        )}

        {paymentNote && (
          <p className="auth-error" style={{ marginBottom: '1rem' }}>
            {paymentNote}
          </p>
        )}

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
              placeholder={singles ? user.full_name : 'e.g. UL Smash'}
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
                  title={friendPartners.length === 0 ? 'Add friends in Community first' : undefined}
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
                  <SearchableSelect
                    id="join-partner-friend"
                    aria-labelledby="join-partner-label"
                    value={form.partner_user_id}
                    onChange={(partner_user_id) => setForm({ ...form, partner_user_id })}
                    placeholder="Select a friend"
                    searchPlaceholder="Search friends by name…"
                    emptyLabel="No friends match that name"
                    required={friendPartners.length > 0}
                    disabled={friendPartners.length === 0}
                    options={friendPartners.map((f) => ({
                      value: f.user_id,
                      label: f.university_short
                        ? `${f.full_name} (${f.university_short})`
                        : f.full_name,
                      keywords: f.full_name,
                    }))}
                  />
                  {friendPartners.length === 0 && (
                    <p className="muted-note">
                      {friendsBusyElsewhere.length > 0
                        ? 'Your friends are already entered in this event. Switch to email for someone else, or ask the organiser to free a spot.'
                        : (
                          <>
                            No friends yet.{' '}
                            <Link to="/community">Add friends in Community</Link>, or use email.
                          </>
                        )}
                    </p>
                  )}
                  {friendsBusyElsewhere.length > 0 && friendPartners.length > 0 && (
                    <p className="muted-note">
                      Hidden {friendsBusyElsewhere.length} friend
                      {friendsBusyElsewhere.length === 1 ? '' : 's'} already entered in this event.
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
                    placeholder="Partner’s full name"
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
                    placeholder="Partner’s email"
                    required
                  />
                  <p className="muted-note">
                    Use the email they signed up with if they already have an account. They won’t be charged.
                  </p>
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
            <SearchableSelect
              id="join-uni"
              value={form.university_id}
              onChange={(university_id) => setForm({ ...form, university_id })}
              placeholder="Select university"
              searchPlaceholder="Search universities…"
              emptyLabel="No university matches that name"
              required
              options={universities.map((u) => ({
                value: u.id,
                label: u.name,
                keywords: u.short_name || '',
              }))}
            />
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
              ? 'Processing…'
              : publicConfig?.demo_payments
                ? `${resumingPending ? 'Finish' : 'Confirm'} ${teamFee} (demo)`
                : `${resumingPending ? 'Pay' : 'Pay'} ${teamFee}`}
          </button>
          {resumingPending && myTeam?.can_leave ? (
            <LeaveTournamentButton
              tournamentId={tournament.id}
              slug={tournament.slug}
              paymentStatus={myPayment}
              teamName={myTeam.name}
              singles={singles}
              className="btn btn-ghost btn-block"
              onLeft={() => navigate(`/t/${tournament.slug}`, { replace: true })}
            />
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={() => navigate(`/t/${slug}`)}
            >
              Back
            </button>
          )}
        </form>
      </main>
    </div>
  )
}
