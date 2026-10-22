import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import BackButton from '../components/BackButton'
import BrandLogo from '../components/BrandLogo'
import LeaveTournamentButton from '../components/LeaveTournamentButton'
import NavBar from '../components/NavBar'
import SearchableSelect from '../components/SearchableSelect'
import { useAuth } from '../context/AuthContext'
import { scrollFieldAboveKeyboard, useKeyboardInset } from '../hooks/useKeyboardInset'
import { hapticSuccess } from '../native/haptics'
import { isNativeApp } from '../native/platform'
import { openExternalUrl, whenExternalBrowserCloses } from '../native/shell'
import {
  apiErrorMessage,
  apiErrorStatus,
  communityApi,
  platformApi,
  tournamentApi,
  type PlayerSearch,
  type RegistrationConfirm,
} from '../services/api'
import { formatMoney, formatPerPlayerFee, isPastCalendarDate, tournamentFormatSummary } from '../utils/format'
import './Tournament.css'

function paymentLabel(status: string, paymentVia?: string | null) {
  if (paymentVia === 'pay_on_arrival') return 'Pay at the venue'
  if (paymentVia === 'collected_on_arrival') return 'Collected at venue'
  if (paymentVia === 'free_entry') return 'Free'
  if (status === 'PAID') return 'Paid'
  if (status === 'PENDING') return 'Awaiting payment'
  return status.replace(/_/g, ' ')
}

function ConfirmView({ data }: { data: RegistrationConfirm }) {
  const navigate = useNavigate()
  const slug = data.tournament?.slug
  const tournamentId = data.tournament?.id
  const confirmed = data.status === 'PAID'
  // Only treat as owing-at-venue when payment_via says so (not merely tournament setting)
  const payOnArrival = data.payment_via === 'pay_on_arrival'
  const fullyPaid = confirmed && !payOnArrival
  const pending = data.status === 'PENDING'
  const isCaptain = data.slot == null || data.slot === 1
  const singles = data.tournament?.play_format === 'SINGLES'
  const canLeave = !!data.can_leave

  useEffect(() => {
    if (confirmed) void hapticSuccess()
  }, [confirmed])

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page confirm-page">
        <BackButton fallbackTo={slug ? `/t/${slug}` : '/tournaments'} />
        {!isNativeApp() ? <BrandLogo to="/tournaments" className="confirm-brand" size="sm" /> : null}
        <h1 className="page-title">
          {confirmed ? (payOnArrival ? 'You’re in' : 'Registration confirmed') : 'Registration received'}
        </h1>
        <p className="confirm-tour">{data.tournament?.name}</p>
        <div className="confirm-box">
          {(() => {
            const names = [...new Set(data.players.filter(Boolean))]
            const teamLabel = (data.team_name || '').trim()
            const singlesSameName =
              singles && names.length === 1 && names[0].toLowerCase() === teamLabel.toLowerCase()
            return (
              <>
                <div>
                  <span>{singles ? 'Entry' : 'Team'}</span>
                  <strong>{teamLabel || '—'}</strong>
                </div>
                {!singlesSameName && (
                  <div>
                    <span>{singles ? 'Player' : 'Players'}</span>
                    <strong>
                      {names.length === 0
                        ? '—'
                        : names.map((p, i) => (
                            <span key={`${p}-${i}`} style={{ display: 'block' }}>
                              {p}
                            </span>
                          ))}
                    </strong>
                  </div>
                )}
              </>
            )
          })()}
          <div>
            <span>Payment</span>
            <strong className={fullyPaid ? 'paid' : ''}>
              {formatMoney(data.amount_cents, data.currency)} ·{' '}
              {paymentLabel(data.status, data.payment_via)}
            </strong>
          </div>
        </div>
        {payOnArrival && (
          <p className="confirm-venue-note" role="status">
            Your spot is reserved. Bring {formatMoney(data.amount_cents, data.currency)} to pay the
            organiser at the venue
            {!singles ? ' (full team fee)' : ''}.
          </p>
        )}
        {slug && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {confirmed ? (
              <Link to={`/t/${slug}/live`} className="btn btn-primary btn-block">
                Go to my matches
              </Link>
            ) : isCaptain ? (
              <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block">
                Complete payment
              </Link>
            ) : (
              <p className="muted-note">
                You’re on this team already. Your teammate needs to finish payment — or leave below if
                you want out.
              </p>
            )}
            {payOnArrival && isCaptain && tournamentId && data.amount_cents > 0 && (
              <ConfirmPayOnlineButton tournamentId={tournamentId} slug={slug} feeLabel={formatMoney(data.amount_cents, data.currency)} />
            )}
            <Link to={`/t/${slug}`} className="btn btn-ghost btn-block">
              Tournament page
            </Link>
            {(pending || (confirmed && canLeave)) && canLeave && tournamentId && (
              <LeaveTournamentButton
                tournamentId={tournamentId}
                slug={slug}
                paymentStatus={data.status}
                paymentVia={data.payment_via}
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

function ConfirmPayOnlineButton({
  tournamentId,
  slug,
  feeLabel,
}: {
  tournamentId: string
  slug: string
  feeLabel: string
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const checkoutDisposeRef = useRef<(() => void) | null>(null)

  useEffect(() => () => checkoutDisposeRef.current?.(), [])

  const onClick = async () => {
    setBusy(true)
    setErr('')
    try {
      const { data } = await tournamentApi.payOnlineNow(tournamentId)
      if (data.checkout_url) {
        if (isNativeApp()) {
          const regId = data.registration_id
          checkoutDisposeRef.current?.()
          const dispose = await whenExternalBrowserCloses(() => {
            checkoutDisposeRef.current = null
            void (async () => {
              try {
                const { data: reg } = await tournamentApi.getRegistration(regId)
                if (reg.status === 'PAID' && reg.payment_via !== 'pay_on_arrival') {
                  navigate(`/t/${slug}/confirmed?registration_id=${regId}`, { replace: true })
                  return
                }
                if (reg.status === 'PAID') {
                  navigate(`/t/${slug}/confirmed?registration_id=${regId}`, { replace: true })
                  return
                }
              } catch {
                /* fall through */
              }
              setErr('Payment was not completed. If you paid, open My matches or try again shortly.')
              setBusy(false)
            })()
          })
          checkoutDisposeRef.current = dispose
          try {
            await openExternalUrl(data.checkout_url)
          } catch {
            dispose()
            checkoutDisposeRef.current = null
            setErr('Could not open payment page')
            setBusy(false)
          }
          return
        }
        window.location.href = data.checkout_url
        return
      }
      navigate(`/t/${slug}/confirmed?registration_id=${data.registration_id}`, { replace: true })
    } catch (e: unknown) {
      setErr(apiErrorMessage(e, 'Could not start online payment'))
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => void onClick()}>
        {busy ? 'Opening…' : `Pay ${feeLabel} online now`}
      </button>
      {err && <p className="auth-error">{err}</p>}
    </>
  )
}

type MyTeamInfo = {
  id: string
  name: string
  payment_status?: string | null
  payment_via?: string | null
  slot?: number | null
  players?: string[]
  partner_user_id?: string | null
  partner_name?: string | null
  partner_email?: string | null
  can_leave?: boolean
}

export default function JoinTournamentPage() {
  const { slug = '' } = useParams()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')
  const registrationId = params.get('registration_id')
  const paymentCancelled = params.get('cancelled') === '1'
  const isConfirmRoute = pathname.includes('/confirmed') || !!sessionId
  const hasConfirmParams = !!sessionId || !!registrationId

  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [paymentNote, setPaymentNote] = useState(
    paymentCancelled ? 'Payment was cancelled. You can try again when ready.' : '',
  )
  const [friendSearch, setFriendSearch] = useState('')
  const [friendFindOpen, setFriendFindOpen] = useState(false)
  const [partnerMode, setPartnerMode] = useState<'friend' | 'email'>('email')
  const [friendActionError, setFriendActionError] = useState('')
  useKeyboardInset(!isConfirmRoute)

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (!t.closest('.page')) return
      if (t.matches('input, textarea, select')) scrollFieldAboveKeyboard(t)
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  const { data: tournament, isLoading: tLoading, isError: tError } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: async () => (await tournamentApi.get(slug)).data,
    enabled: !!slug && !isConfirmRoute,
  })

  const {
    data: playerView,
    isLoading: pvLoading,
    isError: pvError,
    refetch: refetchPlayerView,
  } = useQuery({
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
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const checkoutDisposeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      checkoutDisposeRef.current?.()
      checkoutDisposeRef.current = null
    }
  }, [])

  // Prefill from profile whenever /me catches up — only fills empty fields so typing isn’t overwritten
  useEffect(() => {
    if (!user) return
    const singlesPrefill = tournament?.play_format === 'SINGLES'
    setForm((f) => ({
      ...f,
      phone: f.phone || user.phone || '',
      university_id: f.university_id || user.university_id || '',
      // Doubles: leave team name blank so it isn’t confused with the player roster
      team_name: f.team_name || (singlesPrefill ? user.full_name || '' : ''),
    }))
  }, [user, tournament?.play_format])

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

  const showFriendSearch =
    partnerMode === 'friend' && (friendFindOpen || friendPartners.length === 0)
  const playerSearchQ = useQuery({
    queryKey: ['join-player-search', friendSearch],
    queryFn: async () => (await communityApi.searchPlayers(friendSearch)).data,
    enabled:
      !!user && !isConfirmRoute && showFriendSearch && friendSearch.trim().length >= 2,
  })

  const friendsBusyElsewhere = useMemo(() => {
    return friends.filter(
      (f) =>
        f.direction === 'friend' &&
        enteredUserIds.has(f.user_id) &&
        f.user_id !== resumePartnerId,
    )
  }, [friends, enteredUserIds, resumePartnerId])

  const incomingFriends = useMemo(
    () => friends.filter((f) => f.direction === 'incoming'),
    [friends],
  )

  const refreshFriends = () => {
    qc.invalidateQueries({ queryKey: ['friends'] })
    qc.invalidateQueries({ queryKey: ['join-player-search'] })
  }

  const requestFriendMut = useMutation({
    mutationFn: (userId: string) => communityApi.requestFriend(userId),
    onSuccess: () => {
      setFriendActionError('')
      refreshFriends()
    },
    onError: (e) => setFriendActionError(apiErrorMessage(e, 'Could not send friend request')),
  })

  const acceptFriendMut = useMutation({
    mutationFn: (id: string) => communityApi.acceptFriend(id),
    onSuccess: (res) => {
      setFriendActionError('')
      refreshFriends()
      const friend = res.data
      if (!friend?.user_id) return
      setForm((f) => ({
        ...f,
        partner_user_id: friend.user_id,
        partner_name: friend.full_name || f.partner_name,
        partner_email: '',
      }))
      setFriendFindOpen(false)
      setFriendSearch('')
    },
    onError: (e) => setFriendActionError(apiErrorMessage(e, 'Could not accept friend request')),
  })

  const resumeDefaultsApplied = useRef(false)
  useEffect(() => {
    resumeDefaultsApplied.current = false
  }, [slug])
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
            <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
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

  if (user && pvError) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Could not load your entry</h1>
          <p className="page-sub">Check your connection and try again before joining.</p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={() => void refetchPlayerView()}>
              Retry
            </button>
            <Link to={`/t/${tournament.slug}`} className="btn btn-ghost">
              Tournament page
            </Link>
          </div>
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
          {myTeam.payment_via === 'pay_on_arrival' && (
            <p className="confirm-venue-note" role="status">
              Pay {formatMoney(tournament.entry_fee_cents, tournament.currency)} to the organiser at
              the venue{!singles ? ' (full team fee)' : ''}.
            </p>
          )}
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link to={`/t/${tournament.slug}/live`} className="btn btn-primary">
              My matches
            </Link>
            {myTeam.payment_via === 'pay_on_arrival' &&
              (mySlot === 1 || mySlot == null) &&
              tournament.entry_fee_cents > 0 && (
                <ConfirmPayOnlineButton
                  tournamentId={tournament.id}
                  slug={tournament.slug}
                  feeLabel={formatMoney(tournament.entry_fee_cents, tournament.currency)}
                />
              )}
            <Link to={`/t/${tournament.slug}`} className="btn btn-ghost">
              Tournament page
            </Link>
          </div>
          {myTeam.can_leave && (
            <>
              <p className="muted-note entry-leave-note">
                Need to pull out before the event starts? You can leave below.
                {myTeam.payment_via === 'pay_on_arrival'
                  ? ' You haven’t paid online — this just frees your spot.'
                  : ' Fees aren’t refunded automatically — message the organiser if you need one.'}
              </p>
              <LeaveTournamentButton
                tournamentId={tournament.id}
                slug={tournament.slug}
                paymentStatus={myPayment}
                paymentVia={myTeam.payment_via}
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
          <h1 className="page-title">You’re on this team</h1>
          <p className="page-sub">
            You’re already on <strong>{myTeam.name}</strong>
            {myTeam.players?.length ? ` (${myTeam.players.join(' / ')})` : ''}. No invite to accept —
            your teammate just needs to finish payment. If you can’t play, leave below so they can
            re-enter with someone else.
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
                paymentVia={myTeam.payment_via}
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
                paymentVia={myTeam.payment_via}
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

  const startCheckoutRedirect = async (
    checkoutUrl: string,
    registrationId: string,
  ): Promise<boolean> => {
    if (isNativeApp()) {
      checkoutDisposeRef.current?.()
      const dispose = await whenExternalBrowserCloses(() => {
        checkoutDisposeRef.current = null
        void (async () => {
          try {
            const { data: reg } = await tournamentApi.getRegistration(registrationId)
            if (reg.status === 'PAID' && reg.payment_via !== 'pay_on_arrival') {
              navigate(`/t/${slug}/confirmed?registration_id=${registrationId}`, { replace: true })
              return
            }
            if (reg.status === 'PAID') {
              navigate(`/t/${slug}/confirmed?registration_id=${registrationId}`, { replace: true })
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
        await openExternalUrl(checkoutUrl)
        return true
      } catch {
        dispose()
        checkoutDisposeRef.current = null
        setError('Could not open payment page')
        return false
      }
    }
    window.location.href = checkoutUrl
    return true
  }

  const submitJoin = async (payOnlineNow: boolean) => {
    setLoading(true)
    setError('')
    setPaymentNote('')
    let holdLoadingForCheckout = false

    if (!singles) {
      if (partnerMode === 'friend' && !form.partner_user_id) {
        setError('Pick a partner, or switch to email')
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
        student_number: null,
        pay_online_now: payOnlineNow,
      }
      if (!singles) {
        if (partnerMode === 'friend' && form.partner_user_id) {
          const fromFriends = friendPartners.find((f) => f.user_id === form.partner_user_id)
          payload.partner_user_id = form.partner_user_id
          payload.partner_name = fromFriends?.full_name || form.partner_name || null
          payload.partner_email = null
        } else {
          payload.partner_name = form.partner_name
          payload.partner_email = form.partner_email
        }
      }

      const { data } = await tournamentApi.register(tournament.id, payload)
      if (data.checkout_url) {
        holdLoadingForCheckout = true
        const held = await startCheckoutRedirect(data.checkout_url, data.registration_id)
        if (!held) holdLoadingForCheckout = false
        return
      }
      navigate(`/t/${slug}/confirmed?registration_id=${data.registration_id}`, { replace: true })
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Registration failed'))
    } finally {
      if (!holdLoadingForCheckout) setLoading(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submitJoin(false)
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <BackButton fallbackTo={slug ? `/t/${slug}` : '/tournaments'} />
        <h1 className="page-title">Join {tournament.name}</h1>
        <p className="page-sub">
          {tournamentFormatSummary(tournament.play_format, tournament.format)} · {perPlayer}
          {!singles ? ` · team fee ${teamFee}` : ''}
        </p>

        {resumingPending && (
          <p className="form-success" style={{ marginBottom: '1rem' }}>
            You already started <strong>{myTeam?.name}</strong>. Update details if needed and{' '}
            {tournament.pay_on_arrival ? 'confirm your entry' : 'finish payment'}
            {tournament.status !== 'REGISTRATION_OPEN' || deadlineGone || isFull
              ? ' — registration may be closed or full for new entries, but you can still complete yours if a spot remains.'
              : '.'}
          </p>
        )}

          {!singles && (
            <p className="muted-note join-pay-note">
              {tournament.pay_on_arrival ? (
                <>
                  Team entry is <strong>{teamFee}</strong> (you cover both players). Confirm now and pay
                  at the venue, or pay the full amount online below. Your partner is added
                  automatically — they can leave the team if they can’t play.
                </>
              ) : (
                <>
                  You pay the full team entry of <strong>{teamFee}</strong>. Your partner is added
                  automatically and is not charged separately — they can leave if they can’t play.
                </>
              )}
            </p>
          )}
          {singles && tournament.pay_on_arrival && (
            <p className="muted-note join-pay-note">
              Entry is <strong>{teamFee}</strong> — confirm now and pay at the venue, or pay online
              below.
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
              <div className="partner-mode-row" role="tablist" aria-label="How to add partner">
                <button
                  type="button"
                  role="tab"
                  aria-selected={partnerMode === 'email'}
                  className={`filter-chip ${partnerMode === 'email' ? 'on' : ''}`}
                  onClick={() => {
                    setPartnerMode('email')
                    setForm((f) => ({ ...f, partner_user_id: '' }))
                    setFriendFindOpen(false)
                    setFriendActionError('')
                  }}
                >
                  Email
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={partnerMode === 'friend'}
                  className={`filter-chip ${partnerMode === 'friend' ? 'on' : ''}`}
                  onClick={() => {
                    setPartnerMode('friend')
                    setForm((f) => ({ ...f, partner_name: '', partner_email: '' }))
                    setFriendFindOpen(false)
                    setFriendActionError('')
                  }}
                >
                  Friend
                </button>
              </div>
              {partnerMode === 'friend' ? (
                <>
                  {(friendPartners.length > 0 || form.partner_user_id) && (
                    <SearchableSelect
                      id="join-partner-friend"
                      aria-labelledby="join-partner-label"
                      value={form.partner_user_id}
                      onChange={(partner_user_id) =>
                        setForm({ ...form, partner_user_id, partner_name: '', partner_email: '' })
                      }
                      placeholder="Select a friend"
                      searchPlaceholder="Search friends by name…"
                      emptyLabel="No friends match that name"
                      required={!form.partner_user_id}
                      options={[
                        ...(form.partner_user_id &&
                        !friendPartners.some((f) => f.user_id === form.partner_user_id)
                          ? [
                              {
                                value: form.partner_user_id,
                                label: form.partner_name || 'Selected partner',
                                keywords: form.partner_name || 'selected',
                              },
                            ]
                          : []),
                        ...friendPartners.map((f) => ({
                          value: f.user_id,
                          label: f.university_short
                            ? `${f.full_name} (${f.university_short})`
                            : f.full_name,
                          keywords: f.full_name,
                        })),
                      ]}
                    />
                  )}
                  {friendsBusyElsewhere.length > 0 && (
                    <p className="muted-note">
                      {friendsBusyElsewhere.length} friend
                      {friendsBusyElsewhere.length === 1 ? '' : 's'} already entered — hidden from
                      this list.
                    </p>
                  )}
                  <div className="partner-find">
                    {friendPartners.length > 0 && (
                      <button
                        type="button"
                        className="partner-find-toggle"
                        aria-expanded={friendFindOpen}
                        onClick={() => {
                          setFriendFindOpen((v) => !v)
                        }}
                      >
                        {friendFindOpen ? 'Hide friend search' : 'Find & add a friend'}
                      </button>
                    )}
                    {showFriendSearch && (
                      <div className="partner-find-panel">
                        <label className="form-label" htmlFor="join-friend-search">
                          {friendPartners.length === 0
                            ? 'Find a friend to partner with'
                            : 'Search players by name'}
                        </label>
                        <input
                          id="join-friend-search"
                          className="form-input"
                          value={friendSearch}
                          onChange={(e) => setFriendSearch(e.target.value)}
                          placeholder="Type at least 2 letters"
                          autoComplete="off"
                          autoCapitalize="words"
                          enterKeyHint="search"
                        />
                        {friendActionError && (
                          <p className="form-error" role="alert">
                            {friendActionError}
                          </p>
                        )}
                        {friendSearch.trim().length >= 2 && (
                          <div className="partner-find-results">
                            {(playerSearchQ.data || []).map((p: PlayerSearch) => {
                              const busy =
                                enteredUserIds.has(p.id) && p.id !== resumePartnerId
                              const selected = form.partner_user_id === p.id
                              const isFriend =
                                p.friendship_status === 'friends' ||
                                friendPartners.some((f) => f.user_id === p.id)
                              const pendingOut = p.friendship_status === 'pending_out'
                              const pendingIn = p.friendship_status === 'pending_in'
                              const requesting =
                                requestFriendMut.isPending && requestFriendMut.variables === p.id
                              const accepting =
                                acceptFriendMut.isPending &&
                                incomingFriends.some(
                                  (f) =>
                                    f.user_id === p.id && acceptFriendMut.variables === f.id,
                                )
                              return (
                                <div key={p.id} className="partner-find-row">
                                  <div className="partner-find-meta">
                                    <strong>{p.full_name}</strong>
                                    <span className="rank-meta">
                                      {p.university_short || '—'}
                                      {busy
                                        ? ' · already entered'
                                        : isFriend
                                          ? ' · friends'
                                          : pendingOut
                                            ? ' · request sent'
                                            : pendingIn
                                              ? ' · requested you'
                                              : ''}
                                    </span>
                                  </div>
                                  <div className="partner-find-actions">
                                    {busy ? (
                                      <span className="muted-note">Unavailable</span>
                                    ) : isFriend ? (
                                      <button
                                        type="button"
                                        className={`btn btn-sm ${selected ? 'btn-dark' : 'btn-primary'}`}
                                        onClick={() => {
                                          setForm({
                                            ...form,
                                            partner_user_id: p.id,
                                            partner_name: p.full_name,
                                            partner_email: '',
                                          })
                                          setFriendFindOpen(false)
                                          setFriendSearch('')
                                        }}
                                      >
                                        {selected ? 'Selected' : 'Select'}
                                      </button>
                                    ) : pendingIn ? (
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-dark"
                                        disabled={accepting}
                                        onClick={() => {
                                          const fr = incomingFriends.find((f) => f.user_id === p.id)
                                          if (fr) acceptFriendMut.mutate(fr.id)
                                        }}
                                      >
                                        {accepting ? 'Accepting…' : 'Accept'}
                                      </button>
                                    ) : pendingOut ? (
                                      <span className="muted-note">Waiting</span>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-dark"
                                        disabled={requesting}
                                        onClick={() => requestFriendMut.mutate(p.id)}
                                      >
                                        {requesting ? 'Sending…' : 'Add'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            {!playerSearchQ.isLoading &&
                              friendSearch.trim().length >= 2 &&
                              (playerSearchQ.data || []).length === 0 && (
                                <p className="muted-note">
                                  No players found. Switch to Email if they’re new to the app.
                                </p>
                              )}
                            {playerSearchQ.isLoading && (
                              <p className="muted-note">Searching…</p>
                            )}
                          </div>
                        )}
                        <p className="muted-note">
                          Add them as a friend, then select as partner. Or use Email if they’re new
                          to the app.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <input
                    id="join-partner-name"
                    className="form-input"
                    aria-label="Partner name"
                    name="partner-name"
                    value={form.partner_name}
                    onChange={(e) => setForm({ ...form, partner_name: e.target.value })}
                    placeholder="Partner’s full name"
                    required
                    minLength={2}
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    style={{ marginBottom: 8 }}
                  />
                  <input
                    id="join-partner-email"
                    className="form-input"
                    type="email"
                    aria-label="Partner email"
                    name="partner-email"
                    value={form.partner_email}
                    onChange={(e) => setForm({ ...form, partner_email: e.target.value })}
                    placeholder="Partner’s email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="next"
                  />
                  <p className="muted-note">
                    If they already have an account with that email, we link it. If not, we email
                    them to sign up with that address — that account becomes your partner. They
                    won’t be charged.
                  </p>
                </>
              )}
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="join-phone">
              Phone <span className="muted">(optional)</span>
            </label>
            <input
              id="join-phone"
              className="form-input"
              type="tel"
              name="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              autoComplete="tel"
              inputMode="tel"
              enterKeyHint="done"
              placeholder="Optional"
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
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {tournament.pay_on_arrival ? (
            <p className="muted-note">
              Default: reserve your spot now and pay {teamFee} at the venue
              {!singles ? ' (full team fee)' : ''}.
            </p>
          ) : publicConfig?.demo_payments ? (
            <p className="muted-note">Demo checkout. No card will be charged.</p>
          ) : null}
          <button className="btn btn-primary btn-block" disabled={loading || tLoading}>
            {loading
              ? 'Processing…'
              : tournament.pay_on_arrival
                ? resumingPending
                  ? 'Confirm entry · pay at venue'
                  : singles
                    ? `Confirm entry · pay ${teamFee} at venue`
                    : `Confirm entry · pay ${teamFee} at venue`
                : publicConfig?.demo_payments
                  ? `${resumingPending ? 'Finish' : 'Confirm'} ${teamFee} (demo)`
                  : `${resumingPending ? 'Pay' : 'Pay'} ${teamFee}`}
          </button>
          {tournament.pay_on_arrival && tournament.entry_fee_cents > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-block"
              disabled={loading || tLoading}
              onClick={() => void submitJoin(true)}
            >
              {loading
                ? 'Processing…'
                : singles
                  ? `Pay ${teamFee} online now`
                  : `Pay ${teamFee} online now (full team)`}
            </button>
          )}
          {resumingPending && myTeam?.can_leave ? (
            <LeaveTournamentButton
              tournamentId={tournament.id}
              slug={tournament.slug}
              paymentStatus={myPayment}
              paymentVia={myTeam.payment_via}
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
