import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import BackButton from '../components/BackButton'
import BrandLogo from '../components/BrandLogo'
import LeaveTournamentButton from '../components/LeaveTournamentButton'
import NavBar from '../components/NavBar'
import SearchableSelect from '../components/SearchableSelect'
import SponsorStrip from '../components/SponsorStrip'
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
  type CustomAnswer,
  type PlayerSearch,
  type RegistrationConfirm,
  type TournamentRegistrationField,
} from '../services/api'
import {
  formatMoney,
  formatOnlineFee,
  formatOnlineTotal,
  formatPerPlayerFee,
  isPastCalendarDate,
  onlineTotalCents,
  reminderPromiseCopy,
  tournamentFormatSummary,
} from '../utils/format'
import './Tournament.css'

function paymentLabel(status: string, paymentVia?: string | null) {
  if (paymentVia === 'pay_on_arrival') return 'Pay at the venue'
  if (paymentVia === 'collected_on_arrival') return 'Collected at venue'
  if (paymentVia === 'free_entry') return 'Free'
  if (status === 'PAID') return 'Paid'
  if (status === 'PENDING') return 'Awaiting payment'
  return status.replace(/_/g, ' ')
}

/** Stripe Checkout URLs embed cs_live_… / cs_test_… — use for native return confirm. */
function checkoutSessionIdFromUrl(checkoutUrl: string): string | null {
  const match = checkoutUrl.match(/\bcs_(?:live|test)_[A-Za-z0-9]+/)
  return match?.[0] ?? null
}

async function waitMs(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

/** After returning from Stripe, poll until PAID (webhook / confirm race). */
async function pollRegistrationPaid(
  registrationId: string,
  checkoutUrl?: string | null,
): Promise<RegistrationConfirm | null> {
  const sessionId = checkoutUrl ? checkoutSessionIdFromUrl(checkoutUrl) : null
  const delays = [0, 800, 1600, 2800, 4000]
  for (const delay of delays) {
    if (delay) await waitMs(delay)
    try {
      if (sessionId) {
        const { data } = await tournamentApi.confirmPaymentSession(sessionId)
        if (data.status === 'PAID') return data
      }
    } catch {
      /* fall through to registration lookup */
    }
    try {
      const { data } = await tournamentApi.getRegistration(registrationId)
      if (data.status === 'PAID') return data
    } catch {
      /* retry */
    }
  }
  return null
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
  const reminderNote = confirmed ? reminderPromiseCopy(data.tournament?.event_date) : ''
  const { data: publicConfig } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => (await platformApi.publicConfig()).data,
    staleTime: 60_000,
  })
  const entryFeeCents = data.tournament?.entry_fee_cents ?? data.amount_cents
  const serviceFeeCents = publicConfig?.service_fee_cents ?? 0
  const onlineTotalLabel = formatOnlineTotal(entryFeeCents, serviceFeeCents, data.currency)
  const paidOnlineWithFee =
    confirmed && !payOnArrival && serviceFeeCents > 0 && data.amount_cents > entryFeeCents

  useEffect(() => {
    if (confirmed) void hapticSuccess()
  }, [confirmed])

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page confirm-page">
        <BackButton fallbackTo={slug ? `/t/${slug}` : '/tournaments'} />
        {!isNativeApp() ? <BrandLogo to="/tournaments" className="confirm-brand" size="sm" /> : null}
        {confirmed ? (
          <div className="tour-entry-banner" role="status">
            <p className="tour-entry-badge">You’re in</p>
            <h1 className="tour-entry-title">
              {(data.team_name || '').trim() || data.tournament?.name || 'Entry confirmed'}
            </h1>
            {(() => {
              const names = [...new Set(data.players.filter(Boolean))]
              const teamLabel = (data.team_name || '').trim()
              const singlesSameName =
                singles && names.length === 1 && names[0].toLowerCase() === teamLabel.toLowerCase()
              if (!names.length || singlesSameName) return null
              return <p className="tour-entry-players">{names.join(' · ')}</p>
            })()}
            <p className="tour-entry-tour-name">{data.tournament?.name}</p>
            <ul className="tour-entry-facts">
              <li>
                {payOnArrival
                  ? `${formatMoney(entryFeeCents, data.currency)} · ${paymentLabel(data.status, data.payment_via)}`
                  : paidOnlineWithFee
                    ? `${formatMoney(data.amount_cents, data.currency)} paid · includes service fee`
                    : `${formatMoney(data.amount_cents, data.currency)} · ${paymentLabel(data.status, data.payment_via)}`}
              </li>
              {payOnArrival ? (
                <li>
                  Spot reserved — bring {formatMoney(entryFeeCents, data.currency)} to the organiser
                  {!singles ? ' for both players' : ''}
                </li>
              ) : (
                <li>
                  {singles
                    ? 'Your spot is locked in'
                    : 'Team spot locked in — you paid for both players'}
                </li>
              )}
              {!singles ? (
                <li>
                  {isCaptain
                    ? 'Your partner was invited — they don’t pay separately'
                    : 'Your teammate registered the pair — you don’t need to pay'}
                </li>
              ) : null}
              {reminderNote ? <li>{reminderNote}</li> : null}
            </ul>
            {slug && (
              <div className="tour-entry-actions">
                <Link to={`/t/${slug}/live`} className="btn btn-primary">
                  View my entry
                </Link>
                {payOnArrival && isCaptain && tournamentId && data.amount_cents > 0 && (
                  <ConfirmPayOnlineButton
                    tournamentId={tournamentId}
                    slug={slug}
                    totalLabel={onlineTotalLabel}
                    feeHint={
                      serviceFeeCents > 0
                        ? formatOnlineFee(entryFeeCents, serviceFeeCents, data.currency)
                        : undefined
                    }
                    coversBothPlayers={!singles}
                  />
                )}
                <Link to={`/t/${slug}`} className="btn btn-ghost tour-entry-btn-ghost">
                  Tournament page
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
            <h1 className="page-title">Registration received</h1>
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
                      <strong>{teamLabel || '-'}</strong>
                    </div>
                    {!singlesSameName && (
                      <div>
                        <span>{singles ? 'Player' : 'Players'}</span>
                        <strong>
                          {names.length === 0
                            ? '-'
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
          </>
        )}
        {!confirmed && slug && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isCaptain ? (
              <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block">
                Complete payment
              </Link>
            ) : (
              <p className="muted-note">
                You’re on this team already. Your teammate needs to finish payment - or leave below if
                you want out.
              </p>
            )}
            <Link to={`/t/${slug}`} className="btn btn-ghost btn-block">
              Tournament page
            </Link>
          </div>
        )}
        {(pending || (confirmed && canLeave)) && canLeave && tournamentId && slug && (
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
      </main>
    </div>
  )
}

function ConfirmPayOnlineButton({
  tournamentId,
  slug,
  totalLabel,
  feeHint,
  coversBothPlayers = false,
}: {
  tournamentId: string
  slug: string
  /** Short total for the button, e.g. "€16.50" */
  totalLabel: string
  /** Optional breakdown shown under the button on narrow screens */
  feeHint?: string
  coversBothPlayers?: boolean
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
      const { data } = await tournamentApi.payOnlineNow(tournamentId, {
        return_origin: typeof window !== 'undefined' ? window.location.origin : undefined,
        native_return: isNativeApp(),
      })
      if (data.checkout_url) {
        if (isNativeApp()) {
          const regId = data.registration_id
          const checkoutUrl = data.checkout_url
          checkoutDisposeRef.current?.()
          const dispose = await whenExternalBrowserCloses(() => {
            checkoutDisposeRef.current = null
            void (async () => {
              const reg = await pollRegistrationPaid(regId, checkoutUrl)
              if (reg?.status === 'PAID') {
                navigate(`/t/${slug}/confirmed?registration_id=${regId}`, { replace: true })
                return
              }
              setErr('Payment was not completed. If you paid, open the tournament page — we will retry confirming.')
              setBusy(false)
            })()
          })
          checkoutDisposeRef.current = dispose
          try {
            await openExternalUrl(checkoutUrl)
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
    <div className="pay-online-wrap">
      <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => void onClick()}>
        {busy
          ? 'Opening…'
          : coversBothPlayers
            ? `Pay online · ${totalLabel} for both`
            : `Pay online · ${totalLabel}`}
      </button>
      {coversBothPlayers ? (
        <p className="pay-online-hint">Pays for you and your friend — they aren’t charged separately</p>
      ) : feeHint ? (
        <p className="pay-online-hint">{feeHint}</p>
      ) : null}
      {coversBothPlayers && feeHint ? <p className="pay-online-hint">{feeHint}</p> : null}
      {err && <p className="auth-error">{err}</p>}
    </div>
  )
}

function JoinDoublesHowItWorks({
  teamFee,
  payOnArrival,
  partnerFirstName,
}: {
  teamFee: string
  payOnArrival: boolean
  partnerFirstName?: string
}) {
  const friend = partnerFirstName?.trim() || 'your friend'
  return (
    <section className="join-how" aria-label="How doubles entry works">
      <div className="join-how-pay-callout" role="status">
        <p className="join-how-pay-kicker">One payment</p>
        <p className="join-how-pay-main">
          You’re paying for <strong>you and {friend}</strong>
        </p>
        <p className="join-how-pay-sub">
          {friend === 'your friend' ? 'They aren’t charged' : `${friend} isn’t charged`} — team fee{' '}
          <strong>{teamFee}</strong>
        </p>
      </div>
      <h2 className="join-how-title">How it works</h2>
      <ol className="join-how-steps">
        <li className="join-how-step">
          <span className="join-how-num" aria-hidden="true">
            1
          </span>
          <div>
            <strong>You sign up first</strong>
            <p>Enter your details and add {friend}</p>
          </div>
        </li>
        <li className="join-how-step">
          <span className="join-how-num" aria-hidden="true">
            2
          </span>
          <div>
            <strong>You pay for you + {friend}</strong>
            <p>
              {payOnArrival
                ? `One team fee of ${teamFee} — online or at the venue`
                : `One team fee of ${teamFee} covers both of you`}
            </p>
          </div>
        </li>
        <li className="join-how-step">
          <span className="join-how-num" aria-hidden="true">
            3
          </span>
          <div>
            <strong>{friend === 'your friend' ? 'They get an invite' : `${friend} gets an invite`}</strong>
            <p>No separate payment — they just join your team</p>
          </div>
        </li>
      </ol>
    </section>
  )
}

function JoinFeeBreakdown({
  entryFeeCents,
  serviceFeeCents,
  currency,
  singles,
  caption,
}: {
  entryFeeCents: number
  serviceFeeCents: number
  currency: string
  singles: boolean
  /** Optional context line, e.g. when venue pay is the default */
  caption?: string
}) {
  if (entryFeeCents <= 0) return null
  const total = onlineTotalCents(entryFeeCents, serviceFeeCents)
  const showFee = serviceFeeCents > 0
  return (
    <div className="join-fee-breakdown" aria-label="Payment breakdown">
      {caption ? <p className="join-fee-caption">{caption}</p> : null}
      {!singles ? (
        <p className="join-fee-covers">This checkout covers you and your friend.</p>
      ) : null}
      <div className="join-fee-row">
        <span>{singles ? 'Entry fee' : 'You + friend (team entry)'}</span>
        <strong>{formatMoney(entryFeeCents, currency)}</strong>
      </div>
      {showFee ? (
        <div className="join-fee-row">
          <span>Service fee</span>
          <strong>{formatMoney(serviceFeeCents, currency)}</strong>
        </div>
      ) : null}
      <div className="join-fee-row join-fee-row--total">
        <span>{singles ? 'Total' : 'You pay for both'}</span>
        <strong>{formatMoney(total, currency)}</strong>
      </div>
    </div>
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
  needs_partner?: boolean
  partner_invite_pending?: boolean
  custom_answers?: CustomAnswer[]
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
  const [partnerMode, setPartnerMode] = useState<'friend' | 'email'>('friend')
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
  const { data: sponsors = [] } = useQuery({
    queryKey: ['sponsors', slug],
    queryFn: async () => (await tournamentApi.sponsors(slug)).data,
    enabled: !!slug && !isConfirmRoute,
    staleTime: 60_000,
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
    refetch: refetchConfirm,
    isFetching: confirmFetching,
  } = useQuery({
    queryKey: ['payment-confirm', sessionId, registrationId],
    queryFn: async () => {
      // Website Stripe return: try session confirm, then registration_id fallback
      if (sessionId) {
        try {
          return (await tournamentApi.confirmPaymentSession(sessionId)).data
        } catch (err: unknown) {
          if (registrationId) {
            try {
              const { data } = await tournamentApi.getRegistration(registrationId)
              if (data.status === 'PAID') return data
            } catch {
              /* rethrow original */
            }
          }
          throw err
        }
      }
      if (registrationId) return (await tournamentApi.getRegistration(registrationId)).data
      throw new Error('Missing session')
    },
    enabled: isConfirmRoute && !!user && hasConfirmParams,
    // Webhook / Stripe redirect often races the first confirm call
    retry: 6,
    retryDelay: (attempt) => Math.min(900 * 2 ** attempt, 5000),
    refetchOnWindowFocus: true,
  })

  const [form, setForm] = useState({
    team_name: '',
    partner_name: '',
    partner_email: '',
    partner_user_id: '',
    phone: '',
    university_id: '',
  })
  /** Answers keyed as fieldId or fieldId:slot for player-scoped fields */
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const checkoutDisposeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      checkoutDisposeRef.current?.()
      checkoutDisposeRef.current = null
    }
  }, [])

  // Prefill from profile whenever /me catches up - only fills empty fields so typing isn’t overwritten
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

  // Prefill custom answers when resuming a pending entry
  useEffect(() => {
    const answers = (playerView?.my_team as MyTeamInfo | null)?.custom_answers
    if (!answers?.length) return
    setCustomAnswers((prev) => {
      if (Object.keys(prev).length > 0) return prev
      const next: Record<string, string> = {}
      for (const a of answers) {
        const key =
          a.scope === 'player' && a.slot != null ? `${a.field_id}:${a.slot}` : a.field_id
        next[key] = a.value
      }
      return next
    })
  }, [playerView?.my_team])

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
      status === 403 ? 'Wrong account' : status === 404 ? 'Still confirming payment' : 'Couldn’t confirm payment'
    const copy =
      status === 403
        ? 'This registration belongs to another account. Log in with the email used at checkout.'
        : status === 404
          ? 'Payment usually lands within a few seconds. Tap try again — if you were charged, your spot will show as paid.'
          : "We couldn't verify this payment yet. If you were charged, tap try again or open the tournament page."

    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{copy}</p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={confirmFetching}
              onClick={() => void refetchConfirm()}
            >
              {confirmFetching ? 'Checking…' : 'Try again'}
            </button>
            <Link to={slug ? `/t/${slug}` : '/tournaments'} className="btn btn-ghost">
              Back to tournament
            </Link>
          </div>
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
  const needsPartner = !!myTeam?.needs_partner && mySlot === 1

  if (myTeam && myPayment === 'PAID' && !needsPartner) {
    const payAtVenue = myTeam.payment_via === 'pay_on_arrival'
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <BackButton fallbackTo={`/t/${tournament.slug}`} />
          <div className="tour-entry-banner" role="status">
            <p className="tour-entry-badge">You’re in</p>
            <h1 className="tour-entry-title">{myTeam.name || tournament.name}</h1>
            {myTeam.players?.length ? (
              <p className="tour-entry-players">{myTeam.players.join(' · ')}</p>
            ) : null}
            <ul className="tour-entry-facts">
              <li>
                {payAtVenue
                  ? singles
                    ? `Pay ${formatMoney(tournament.entry_fee_cents, tournament.currency)} at the venue`
                    : `You owe ${formatMoney(tournament.entry_fee_cents, tournament.currency)} at the venue for both players`
                  : singles
                    ? 'Entry paid · spot confirmed'
                    : 'Team entry paid · covers both players'}
              </li>
              <li>You’re already registered for this tournament</li>
            </ul>
            <div className="tour-entry-actions">
              <Link to={`/t/${tournament.slug}/live`} className="btn btn-primary">
                View my entry
              </Link>
              {payAtVenue &&
                (mySlot === 1 || mySlot == null) &&
                tournament.entry_fee_cents > 0 && (
                  <ConfirmPayOnlineButton
                    tournamentId={tournament.id}
                    slug={tournament.slug}
                    totalLabel={formatOnlineTotal(
                      tournament.entry_fee_cents,
                      publicConfig?.service_fee_cents ?? 0,
                      tournament.currency,
                    )}
                    feeHint={
                      (publicConfig?.service_fee_cents ?? 0) > 0
                        ? formatOnlineFee(
                            tournament.entry_fee_cents,
                            publicConfig?.service_fee_cents ?? 0,
                            tournament.currency,
                          )
                        : undefined
                    }
                    coversBothPlayers={!singles}
                  />
                )}
              <Link to={`/t/${tournament.slug}`} className="btn btn-ghost tour-entry-btn-ghost">
                Tournament page
              </Link>
            </div>
          </div>
          {myTeam.can_leave && (
            <>
              <p className="muted-note entry-leave-note">
                Need to pull out before the event starts? You can leave below.
                {payAtVenue
                  ? ' You haven’t paid online - this just frees your spot.'
                  : ' Fees aren’t refunded automatically - message the organiser if you need one.'}
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
            {myTeam.players?.length ? ` (${myTeam.players.join(' / ')})` : ''}. No invite to accept -
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
  const serviceFeeCents = publicConfig?.service_fee_cents ?? 0
  const onlineTotal = formatOnlineTotal(
    tournament.entry_fee_cents,
    serviceFeeCents,
    tournament.currency,
  )
  // Show breakdown for service fee, and always for doubles so “both players” is obvious
  const showOnlineFeeBreakdown =
    !publicConfig?.demo_payments &&
    tournament.entry_fee_cents > 0 &&
    (serviceFeeCents > 0 || !singles)
  const partnerFirstName = (form.partner_name || '').trim().split(/\s+/)[0] || ''
  const bothLabel = partnerFirstName ? `you & ${partnerFirstName}` : 'you & your friend'
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
          const reg = await pollRegistrationPaid(registrationId, checkoutUrl)
          if (reg?.status === 'PAID') {
            navigate(`/t/${slug}/confirmed?registration_id=${registrationId}`, { replace: true })
            return
          }
          setPaymentNote(
            'Payment was not completed. If you paid, open the tournament page — confirmation will retry automatically.',
          )
          setLoading(false)
          void qc.invalidateQueries({ queryKey: ['player-view', slug] })
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

  const signupFields = (tournament?.registration_fields || []) as TournamentRegistrationField[]

  const answerKey = (fieldId: string, slot?: number) =>
    slot != null ? `${fieldId}:${slot}` : fieldId

  const setAnswer = (fieldId: string, value: string, slot?: number) => {
    const key = answerKey(fieldId, slot)
    setCustomAnswers((prev) => ({ ...prev, [key]: value }))
  }

  const buildCustomAnswersPayload = () => {
    const out: Array<{ field_id: string; value: string; slot?: number }> = []
    for (const field of signupFields) {
      if (field.scope === 'team') {
        const value = (customAnswers[answerKey(field.id)] || '').trim()
        if (field.field_type === 'boolean') {
          if (customAnswers[answerKey(field.id)] != null && customAnswers[answerKey(field.id)] !== '') {
            out.push({ field_id: field.id, value: customAnswers[answerKey(field.id)] })
          }
        } else if (value) {
          out.push({ field_id: field.id, value })
        }
        continue
      }
      const slots = singles ? [1] : [1, 2]
      for (const slot of slots) {
        const key = answerKey(field.id, slot)
        const raw = customAnswers[key]
        if (field.field_type === 'boolean') {
          if (raw != null && raw !== '') out.push({ field_id: field.id, value: raw, slot })
        } else if ((raw || '').trim()) {
          out.push({ field_id: field.id, value: (raw || '').trim(), slot })
        }
      }
    }
    return out
  }

  const validateCustomAnswers = (): string | null => {
    for (const field of signupFields) {
      if (!field.required) continue
      if (field.scope === 'team') {
        const key = answerKey(field.id)
        if (field.field_type === 'boolean') {
          if (customAnswers[key] !== 'yes' && customAnswers[key] !== 'no') {
            return `Answer “${field.label}”`
          }
        } else if (!(customAnswers[key] || '').trim()) {
          return `Enter “${field.label}”`
        }
        continue
      }
      const slots = singles ? [1] : [1, 2]
      for (const slot of slots) {
        const key = answerKey(field.id, slot)
        const who = slot === 2 ? ' for your partner' : ''
        if (field.field_type === 'boolean') {
          if (customAnswers[key] !== 'yes' && customAnswers[key] !== 'no') {
            return `Answer “${field.label}”${who}`
          }
        } else if (!(customAnswers[key] || '').trim()) {
          return `Enter “${field.label}”${who}`
        }
      }
    }
    return null
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

    {
      const customErr = validateCustomAnswers()
      if (customErr) {
        setError(customErr)
        setLoading(false)
        requestAnimationFrame(() => {
          document.getElementById('join-custom-fields')?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })
        })
        return
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
        return_origin: typeof window !== 'undefined' ? window.location.origin : undefined,
        native_return: isNativeApp(),
        custom_answers: buildCustomAnswersPayload(),
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

      // Partner declined / missing - captain re-adds without re-paying
      if (needsPartner) {
        const { data } = await tournamentApi.replacePartner(tournament.id, payload)
        void qc.invalidateQueries({ queryKey: ['player-view', slug] })
        void qc.invalidateQueries({ queryKey: ['notifications'] })
        navigate(`/t/${slug}/confirmed?registration_id=${data.registration_id}`, { replace: true })
        return
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
      setError(apiErrorMessage(err, needsPartner ? 'Could not update partner' : 'Registration failed'))
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
        <h1 className="page-title">
          {needsPartner
            ? `Add a partner · ${tournament.name}`
            : singles
              ? `Join ${tournament.name}`
              : `Register your team`}
        </h1>
        {!needsPartner && !singles ? (
          <p className="page-sub join-page-sub">{tournament.name}</p>
        ) : null}
        {needsPartner && (
          <p className="tour-youre-in" role="status" style={{ marginTop: 0 }}>
            <span className="tour-youre-in-kicker">Partner needed</span>
            <span className="tour-youre-in-body">
              Your previous partner left the team. Pick someone new — your entry stays paid.
            </span>
          </p>
        )}
        <p className="page-sub">
          {tournamentFormatSummary(tournament.play_format, tournament.format)} · {perPlayer}
          {!singles ? ` · team ${teamFee}` : ''}
        </p>
        <SponsorStrip sponsors={sponsors} placement="hero" compact />

        {resumingPending && (
          <p className="form-success" style={{ marginBottom: '1rem' }}>
            You already started <strong>{myTeam?.name}</strong>. Update details if needed and{' '}
            {tournament.pay_on_arrival ? 'confirm your entry' : 'finish payment'}
            {tournament.status !== 'REGISTRATION_OPEN' || deadlineGone || isFull
              ? ' - registration may be closed or full for new entries, but you can still complete yours if a spot remains.'
              : '.'}
          </p>
        )}

          {!singles && !needsPartner && (
            <JoinDoublesHowItWorks
              teamFee={teamFee}
              payOnArrival={tournament.pay_on_arrival}
              partnerFirstName={partnerFirstName}
            />
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
                Your partner
              </label>
              <p className="form-hint join-partner-hint">
                Add your friend here. You’ll pay for both of you — they get an invite and don’t pay.
              </p>
              <div className="partner-mode-row" role="tablist" aria-label="How to add partner">
                <button
                  type="button"
                  role="tab"
                  aria-selected={partnerMode === 'friend'}
                  className={`filter-chip ${partnerMode === 'friend' ? 'on' : ''}`}
                  onClick={() => {
                    setPartnerMode('friend')
                    setForm((f) => ({ ...f, partner_name: '', partner_email: '' }))
                    setFriendFindOpen(friendPartners.length === 0)
                  }}
                >
                  Find player
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={partnerMode === 'email'}
                  className={`filter-chip ${partnerMode === 'email' ? 'on' : ''}`}
                  onClick={() => {
                    setPartnerMode('email')
                    setForm((f) => ({ ...f, partner_user_id: '' }))
                    setFriendFindOpen(false)
                  }}
                >
                  Email invite
                </button>
              </div>
              {partnerMode === 'friend' ? (
                <>
                  {form.partner_user_id && (
                    <div className="partner-selected" role="status">
                      <div>
                        <span className="partner-selected-label">Partner</span>
                        <strong>{form.partner_name || 'Selected player'}</strong>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            partner_user_id: '',
                            partner_name: '',
                            partner_email: '',
                          }))
                        }
                      >
                        Change
                      </button>
                    </div>
                  )}
                  {(friendPartners.length > 0 || form.partner_user_id) && (
                    <SearchableSelect
                      id="join-partner-friend"
                      aria-labelledby="join-partner-label"
                      value={form.partner_user_id}
                      onChange={(partner_user_id) => {
                        const friend = friendPartners.find((f) => f.user_id === partner_user_id)
                        setForm({
                          ...form,
                          partner_user_id,
                          partner_name: friend?.full_name || form.partner_name || '',
                          partner_email: '',
                        })
                      }}
                      placeholder="Or pick a friend"
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
                      {friendsBusyElsewhere.length === 1 ? '' : 's'} already entered - hidden from
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
                        {friendFindOpen ? 'Hide search' : 'Search all players'}
                      </button>
                    )}
                    {showFriendSearch && (
                      <div className="partner-find-panel">
                        <label className="form-label" htmlFor="join-friend-search">
                          {friendPartners.length === 0
                            ? 'Search players to partner with'
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
                        {friendSearch.trim().length >= 2 && (
                          <div className="partner-find-results">
                            {(playerSearchQ.data || []).map((p: PlayerSearch) => {
                              const busy =
                                enteredUserIds.has(p.id) && p.id !== resumePartnerId
                              const selected = form.partner_user_id === p.id
                              const isFriend =
                                p.friendship_status === 'friends' ||
                                friendPartners.some((f) => f.user_id === p.id)
                              return (
                                <div key={p.id} className="partner-find-row">
                                  <div className="partner-find-meta">
                                    <strong>{p.full_name}</strong>
                                    <span className="rank-meta">
                                      {p.university_short || '-'}
                                      {busy
                                        ? ' · already entered'
                                        : isFriend
                                          ? ' · friends'
                                          : p.friendship_status === 'pending_out'
                                            ? ' · request sent'
                                            : p.friendship_status === 'pending_in'
                                              ? ' · requested you'
                                              : ''}
                                    </span>
                                  </div>
                                  <div className="partner-find-actions">
                                    {busy ? (
                                      <span className="muted-note">Unavailable</span>
                                    ) : (
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
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            {!playerSearchQ.isLoading &&
                              friendSearch.trim().length >= 2 &&
                              (playerSearchQ.data || []).length === 0 && (
                                <p className="muted-note">
                                  No players found. Switch to Email invite if they’re new.
                                </p>
                              )}
                            {playerSearchQ.isLoading && (
                              <p className="muted-note">Searching…</p>
                            )}
                          </div>
                        )}
                        <p className="muted-note">
                          They’re invited onto your team straight away. They can Accept or Decline —
                          you still pay the team fee.
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
                    We invite them by email. If they’re new, they create an account with that
                    address. They won’t be charged — you pay for both.
                  </p>
                </>
              )}
            </div>
          )}
          {signupFields.length > 0 && (
            <div className="join-custom-fields" id="join-custom-fields">
              {(() => {
                const teamFields = signupFields.filter((f) => f.scope === 'team')
                const playerFields = signupFields.filter((f) => f.scope !== 'team')
                const splitByPerson = !singles && playerFields.length > 0
                const partnerLabel =
                  (form.partner_name || '').trim() ||
                  (partnerMode === 'friend'
                    ? friendPartners.find((f) => f.user_id === form.partner_user_id)?.full_name
                    : '') ||
                  'your partner'

                const renderControl = (
                  field: TournamentRegistrationField,
                  slot?: number,
                  who?: 'you' | 'partner',
                ) => {
                  const key = answerKey(field.id, slot)
                  const id = `join-cf-${field.id}${slot != null ? `-${slot}` : ''}`
                  const label =
                    who === 'you'
                      ? `Your · ${field.label}`
                      : who === 'partner'
                        ? `${partnerLabel} · ${field.label}`
                        : field.label
                  if (field.field_type === 'boolean') {
                    return (
                      <div className="form-group" key={key}>
                        <span className="form-label" id={`${id}-label`}>
                          {label}
                          {field.required ? '' : <span className="muted"> (optional)</span>}
                        </span>
                        <div className="join-yesno" role="group" aria-labelledby={`${id}-label`}>
                          {(
                            [
                              ['yes', 'Yes'],
                              ['no', 'No'],
                            ] as const
                          ).map(([val, lab]) => (
                            <button
                              key={val}
                              type="button"
                              className={`filter-chip join-yesno-btn ${customAnswers[key] === val ? 'on' : ''}`}
                              aria-pressed={customAnswers[key] === val}
                              onClick={() => setAnswer(field.id, val, slot)}
                            >
                              {lab}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  }
                  if (field.field_type === 'select') {
                    return (
                      <div className="form-group" key={key}>
                        <label className="form-label" htmlFor={id}>
                          {label}
                          {field.required ? '' : <span className="muted"> (optional)</span>}
                        </label>
                        <select
                          id={id}
                          className="form-input"
                          value={customAnswers[key] || ''}
                          required={field.required}
                          onChange={(e) => setAnswer(field.id, e.target.value, slot)}
                        >
                          <option value="">Select…</option>
                          {(field.options || []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  }
                  return (
                    <div className="form-group" key={key}>
                      <label className="form-label" htmlFor={id}>
                        {label}
                        {field.required ? '' : <span className="muted"> (optional)</span>}
                      </label>
                      <input
                        id={id}
                        className="form-input"
                        value={customAnswers[key] || ''}
                        required={field.required}
                        maxLength={500}
                        enterKeyHint="next"
                        autoCapitalize="sentences"
                        onChange={(e) => setAnswer(field.id, e.target.value, slot)}
                        placeholder={field.required ? undefined : 'Optional'}
                      />
                    </div>
                  )
                }

                return (
                  <>
                    <h3 className="join-custom-title">
                      {splitByPerson ? 'Answers for each of you' : 'A few more details'}
                    </h3>
                    {splitByPerson && (
                      <p className="join-custom-hint">
                        Same questions twice — once for <strong>you</strong>, once for{' '}
                        <strong>{partnerLabel}</strong>.
                      </p>
                    )}
                    {teamFields.map((field) => renderControl(field))}
                    {playerFields.length > 0 &&
                      (singles ? (
                        playerFields.map((field) => renderControl(field, 1))
                      ) : (
                        <div className="join-custom-people">
                          <div className="join-custom-person">
                            <p className="join-custom-person-label">
                              <span className="join-custom-person-step">1</span>
                              Your answers
                            </p>
                            {playerFields.map((field) => renderControl(field, 1, 'you'))}
                          </div>
                          <div className="join-custom-person">
                            <p className="join-custom-person-label">
                              <span className="join-custom-person-step">2</span>
                              {partnerLabel === 'your partner'
                                ? "Partner's answers"
                                : `${partnerLabel}'s answers`}
                            </p>
                            {playerFields.map((field) => renderControl(field, 2, 'partner'))}
                          </div>
                        </div>
                      ))}
                  </>
                )
              })()}
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
              {!singles ? ' for both players' : ''}.
            </p>
          ) : publicConfig?.demo_payments ? (
            <p className="muted-note">Demo checkout. No card will be charged.</p>
          ) : null}
          {!needsPartner && showOnlineFeeBreakdown && !tournament.pay_on_arrival && (
            <JoinFeeBreakdown
              entryFeeCents={tournament.entry_fee_cents}
              serviceFeeCents={serviceFeeCents}
              currency={tournament.currency}
              singles={singles}
            />
          )}
          <button className="btn btn-primary btn-block" disabled={loading || tLoading}>
            {loading
              ? needsPartner
                ? 'Saving partner…'
                : 'Processing…'
              : needsPartner
                ? 'Save partner'
                : tournament.pay_on_arrival
                  ? resumingPending
                    ? 'Confirm entry · pay at venue'
                    : singles
                      ? `Confirm entry · pay ${teamFee} at venue`
                      : `Confirm · pay ${teamFee} for ${bothLabel} at venue`
                  : publicConfig?.demo_payments
                    ? singles
                      ? `${resumingPending ? 'Finish' : 'Confirm'} ${teamFee} (demo)`
                      : `${resumingPending ? 'Finish' : 'Confirm'} ${teamFee} for ${bothLabel} (demo)`
                    : singles
                      ? `${resumingPending ? 'Pay' : 'Pay'} ${onlineTotal}`
                      : `${resumingPending ? 'Pay' : 'Pay'} ${onlineTotal} for ${bothLabel}`}
          </button>
          {!needsPartner && tournament.pay_on_arrival && tournament.entry_fee_cents > 0 && (
            <>
              {showOnlineFeeBreakdown ? (
                <JoinFeeBreakdown
                  entryFeeCents={tournament.entry_fee_cents}
                  serviceFeeCents={serviceFeeCents}
                  currency={tournament.currency}
                  singles={singles}
                  caption="Or pay by card now"
                />
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-block"
                disabled={loading || tLoading}
                onClick={() => void submitJoin(true)}
              >
                {loading
                  ? 'Processing…'
                  : singles
                    ? `Pay online · ${onlineTotal}`
                    : `Pay online · ${onlineTotal} for ${bothLabel}`}
              </button>
            </>
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
