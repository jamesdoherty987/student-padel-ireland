import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import BackButton from '../components/BackButton'
import { confirmDialog } from '../components/ConfirmDialog'
import LeaveTournamentButton from '../components/LeaveTournamentButton'
import NavBar from '../components/NavBar'
import NumberInput from '../components/NumberInput'
import SponsorStrip from '../components/SponsorStrip'
import TournamentBracket from '../components/TournamentBracket'
import { useAuth } from '../context/AuthContext'
import { scrollFieldAboveKeyboard, useKeyboardInset } from '../hooks/useKeyboardInset'
import { apiErrorMessage, tournamentApi, type Match } from '../services/api'
import {
  formatDate,
  formatLiveBoardScore,
  formatMatchScore,
  formatMoney,
  formatRelativeStart,
  formatTime,
  courtLabel,
  isKnockoutActive,
  knockoutRoundLabel,
  reminderPromiseCopy,
} from '../utils/format'
import './PlayerLive.css'
import './Tournament.css'

type LiveAnnouncement = {
  id: string
  title: string
  body: string
  is_pinned?: boolean
}

type ScoreSets = {
  set1_a: number
  set1_b: number
  set2_a: number
  set2_b: number
  set3_a: number
  set3_b: number
}

function ScoreStep({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: number
  max: number
  onChange: (n: number) => void
}) {
  return (
    <div className="pl-score-step">
      <button
        type="button"
        className="pl-score-step-btn"
        aria-label={`Decrease ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <NumberInput
        className="pl-score-step-input"
        inputMode="numeric"
        pattern="[0-9]*"
        min={0}
        max={max}
        emptyValue={0}
        value={value}
        onValueChange={(n) => onChange(Math.max(0, Math.min(max, Math.trunc(n))))}
        aria-label={label}
      />
      <button
        type="button"
        className="pl-score-step-btn"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  )
}

function opponentName(m: Match, myTeamId?: string) {
  if (!myTeamId) return null
  if (m.team_a_id === myTeamId) return m.team_b_name || m.team_b_placeholder || 'Opponent'
  if (m.team_b_id === myTeamId) return m.team_a_name || m.team_a_placeholder || 'Opponent'
  return null
}

function mySideName(m: Match, myTeamId?: string, fallback = 'You') {
  if (!myTeamId) return fallback
  if (m.team_a_id === myTeamId) return m.team_a_name || fallback
  if (m.team_b_id === myTeamId) return m.team_b_name || fallback
  return fallback
}

function MatchNames({ m }: { m: Match }) {
  return (
    <>
      {m.team_a_name || m.team_a_placeholder || 'TBD'} vs {m.team_b_name || m.team_b_placeholder || 'TBD'}
    </>
  )
}

function scheduleWhen(m: Match) {
  if (m.status === 'AWAITING_CONFIRM') return 'Score waiting'
  if (m.status === 'CALLED') return 'Called now'
  if (m.status === 'LIVE') return 'Live now'
  const clock = formatTime(m.scheduled_start)
  const relative = formatRelativeStart(m.scheduled_start)
  return relative ? `${clock} · ${relative}` : clock
}

function nextStatusChip(m: Match): { label: string; soft?: boolean } {
  if (m.status === 'CALLED') return { label: 'Go to court now' }
  if (m.status === 'LIVE') return { label: 'Playing now' }
  if (m.status === 'AWAITING_CONFIRM' && m.needs_my_confirm) return { label: 'Confirm this score' }
  if (m.status === 'AWAITING_CONFIRM' && m.score_submitted_by_me) {
    return { label: 'Waiting on opponent', soft: true }
  }
  if (m.status === 'AWAITING_CONFIRM') return { label: 'Score pending', soft: true }
  return { label: 'Up next', soft: true }
}

function nextWhenParts(m: Match): { primary: string; secondary?: string } {
  if (m.status === 'CALLED') return { primary: 'Now', secondary: 'Called to court' }
  if (m.status === 'LIVE') return { primary: 'Now', secondary: 'Match in progress' }
  if (m.status === 'AWAITING_CONFIRM') {
    return {
      primary: m.needs_my_confirm ? 'Confirm score' : 'Waiting',
      secondary: formatTime(m.scheduled_start) !== 'TBC' ? formatTime(m.scheduled_start) : undefined,
    }
  }
  const clock = formatTime(m.scheduled_start)
  const relative = formatRelativeStart(m.scheduled_start)
  return { primary: clock, secondary: relative || undefined }
}

type NextActions = {
  onLogScore: () => void
  onConfirm: () => void
  onEditPending: () => void
  onRejectPending: () => void
  confirming: boolean
  cancelling: boolean
}

function NextMatchCard({
  next,
  slug,
  myTeamId,
  partnerLabel,
  actions,
}: {
  next: Match
  slug: string
  myTeamId?: string
  partnerLabel?: string | null
  actions: NextActions
}) {
  const board = next.status === 'LIVE' ? formatLiveBoardScore(next.score) : null
  const opp = opponentName(next, myTeamId)
  const mine = mySideName(next, myTeamId)
  const court = courtLabel(next.court_name, next.court_number)
  const chip = nextStatusChip(next)
  const when = nextWhenParts(next)
  const round = knockoutRoundLabel(next.round, next.stage)
  const sideA = next.team_a_name || next.team_a_placeholder || 'TBD'
  const sideB = next.team_b_name || next.team_b_placeholder || 'TBD'

  return (
    <div
      className={`pl-next-card pl-next-card--glance ${next.status === 'CALLED' ? 'is-called' : ''} ${next.status === 'LIVE' ? 'is-live' : ''} ${next.status === 'AWAITING_CONFIRM' ? 'is-pending' : ''}`}
    >
      <div className="pl-next-top">
        <p className={`pl-go-now${chip.soft ? ' pl-go-now--soft' : ''}`}>{chip.label}</p>
        <p className="pl-round">{round}</p>
      </div>

      <div className="pl-next-facts" aria-label="Court and time">
        <div className="pl-fact">
          <span className="pl-fact-label">Court</span>
          <span className="pl-fact-value pl-fact-court">{court}</span>
        </div>
        <div className="pl-fact">
          <span className="pl-fact-label">When</span>
          <span className="pl-fact-value">{when.primary}</span>
          {when.secondary ? <span className="pl-fact-sub">{when.secondary}</span> : null}
        </div>
      </div>

      <div className="pl-next-opponent">
        <span className="pl-fact-label">{opp ? 'Playing against' : 'Match'}</span>
        <strong className="pl-opponent-name">{opp || `${sideA} vs ${sideB}`}</strong>
        {opp ? (
          <span className="pl-you-line">
            You{partnerLabel ? ` + ${partnerLabel}` : ''}
            {mine && mine !== 'You' ? ` · ${mine}` : ''}
          </span>
        ) : null}
      </div>

      {board && (
        <p className="pl-next-score">
          Set {board.set} · {board.games}
          {board.sets ? ` · Sets ${board.sets}` : ''}
        </p>
      )}

      {next.status === 'AWAITING_CONFIRM' && next.score && (
        <p className="pl-next-score">Proposed · {formatMatchScore(next.score)}</p>
      )}

      {next.status === 'SCHEDULED' && (
        <p className="pl-next-hint">Keep this page open — we’ll flash when you’re called.</p>
      )}

      <div className="pl-next-actions">
        {next.needs_my_confirm ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={actions.confirming || actions.cancelling}
              onClick={actions.onConfirm}
            >
              {actions.confirming ? 'Confirming…' : 'Confirm score'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block pl-btn-on-dark"
              disabled={actions.cancelling || actions.confirming}
              onClick={actions.onRejectPending}
            >
              {actions.cancelling ? 'Rejecting…' : 'Reject score'}
            </button>
          </>
        ) : next.can_i_score ? (
          <button type="button" className="btn btn-primary btn-block" onClick={actions.onLogScore}>
            Enter score
          </button>
        ) : null}
        {next.score_submitted_by_me && next.status === 'AWAITING_CONFIRM' && (
          <>
            <p className="pl-pending-hint">The other team needs to confirm before this counts.</p>
            <button
              type="button"
              className="btn btn-ghost btn-block pl-btn-on-dark"
              disabled={actions.cancelling}
              onClick={actions.onEditPending}
            >
              {actions.cancelling ? 'Opening…' : 'Edit score'}
            </button>
          </>
        )}
      </div>

      <Link to={`/t/${slug}`} className="pl-details-link">
        Full tournament page
      </Link>
    </div>
  )
}

export default function PlayerLivePage() {
  const { slug = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [scoringMatch, setScoringMatch] = useState<Match | null>(null)
  const [payNote, setPayNote] = useState('')
  const [sets, setSets] = useState<ScoreSets>({
    set1_a: 0,
    set1_b: 0,
    set2_a: 0,
    set2_b: 0,
    set3_a: 0,
    set3_b: 0,
  })
  const [scoreError, setScoreError] = useState('')
  const [actionError, setActionError] = useState('')
  useKeyboardInset(!!scoringMatch)

  useEffect(() => {
    if (!scoringMatch) return
    const onFocus = (e: FocusEvent) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (!t.closest('.score-modal')) return
      if (t.matches('input, textarea, select')) scrollFieldAboveKeyboard(t)
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [scoringMatch])

  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['player-view', slug],
    queryFn: async () => (await tournamentApi.playerView(slug)).data,
    enabled: !!slug,
    retry: 4,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 10000),
    refetchInterval: (query) => (query.state.status === 'error' ? 5000 : 8000),
  })

  const { data: allMatches = [] } = useQuery({
    queryKey: ['matches', slug],
    queryFn: async () => (await tournamentApi.matches(slug)).data,
    enabled: !!slug,
    refetchInterval: 12000,
  })
  const { data: sponsors = [] } = useQuery({
    queryKey: ['sponsors', slug],
    queryFn: async () => (await tournamentApi.sponsors(slug)).data,
    enabled: !!slug,
    staleTime: 60_000,
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['player-view', slug] })
    void qc.invalidateQueries({ queryKey: ['matches', slug] })
  }

  useEffect(() => {
    if (searchParams.get('pay_cancelled') !== '1') return
    setPayNote('Online payment was cancelled. You can still pay at the venue, or try again below.')
    const next = new URLSearchParams(searchParams)
    next.delete('pay_cancelled')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!scoringMatch) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('modal-open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setScoringMatch(null)
        setScoreError('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', onKey)
    }
  }, [scoringMatch])

  const scoreMut = useMutation({
    mutationFn: async () => {
      if (!scoringMatch) throw new Error('No match')
      return (await tournamentApi.playerSubmitScore(scoringMatch.id, sets)).data
    },
    onSuccess: () => {
      setScoringMatch(null)
      setScoreError('')
      setActionError('')
      invalidate()
    },
    onError: (err) => setScoreError(apiErrorMessage(err)),
  })

  const confirmMut = useMutation({
    mutationFn: async (matchId: string) => (await tournamentApi.confirmScore(matchId)).data,
    onSuccess: () => {
      setActionError('')
      invalidate()
    },
    onError: (err) => setActionError(apiErrorMessage(err)),
  })

  const cancelMut = useMutation({
    mutationFn: async ({ matchId, reopen }: { matchId: string; reopen: boolean }) => {
      const m = (await tournamentApi.cancelPendingScore(matchId)).data
      return { m, reopen }
    },
    onSuccess: ({ m, reopen }) => {
      setActionError('')
      invalidate()
      if (reopen) openScoreSheet(m)
    },
    onError: (err) => setActionError(apiErrorMessage(err)),
  })

  const partnerInviteMut = useMutation({
    mutationFn: ({ tournamentId, accept }: { tournamentId: string; accept: boolean }) =>
      tournamentApi.respondPartnerInvite(tournamentId, accept),
    onSuccess: () => {
      setActionError('')
      invalidate()
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      void qc.invalidateQueries({ queryKey: ['friends'] })
    },
    onError: (err) => setActionError(apiErrorMessage(err)),
  })

  const openScoreSheet = (m: Match) => {
    setScoreError('')
    setActionError('')
    setSets({
      set1_a: m.score?.set1_a ?? 0,
      set1_b: m.score?.set1_b ?? 0,
      set2_a: m.score?.set2_a ?? 0,
      set2_b: m.score?.set2_b ?? 0,
      set3_a: m.score?.set3_a ?? 0,
      set3_b: m.score?.set3_b ?? 0,
    })
    setScoringMatch(m)
  }

  if (isLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="pl-page">
          <div className="skeleton" style={{ height: 28, width: '70%', marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 160, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </main>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="pl-page">
          <BackButton fallbackTo={slug ? `/t/${slug}` : '/tournaments'} />
          <div className="empty-state">
            <p>Could not load the live board.</p>
            <p className="muted-note" style={{ marginTop: 8 }}>
              The server may be waking up. Wait a few seconds and try again.
            </p>
            <div className="header-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? 'Retrying…' : 'Retry'}
              </button>
              <Link to="/tournaments" className="btn btn-ghost">
                Tournaments
              </Link>
            </div>
          </div>
        </main>
      </div>
    )
  }

  const t = data.tournament
  const next = data.next_match as Match | null
  const myTeam = data.my_team as {
    id: string
    name: string
    payment_status?: string
    payment_via?: string | null
    slot?: number | null
    can_leave?: boolean
    players?: string[]
    partner_name?: string | null
    partner_invite_pending?: boolean
    needs_partner?: boolean
  } | null
  const myPayment = myTeam?.payment_status
  const myPaymentVia = myTeam?.payment_via
  const mySlot = myTeam?.slot ?? null
  const hasPaidEntry = !!myTeam && myPayment === 'PAID'
  const owesAtVenue = hasPaidEntry && myPaymentVia === 'pay_on_arrival'
  const hasPendingCaptain = !!myTeam && myPayment === 'PENDING' && mySlot === 1
  const isListedPartner = !!myTeam && myPayment === 'PENDING' && mySlot !== 1
  const partnerInvitePending = !!myTeam?.partner_invite_pending && mySlot === 2
  const needsPartner = !!myTeam?.needs_partner && mySlot === 1
  const canLeave = !!myTeam?.can_leave
  const singles = t.play_format === 'SINGLES'
  const myTeamId = hasPaidEntry ? myTeam?.id : undefined
  const partnerLabel = (() => {
    if (singles || !hasPaidEntry) return null
    const full =
      myTeam?.partner_name ||
      (myTeam?.players || []).find((n) => n && n !== user?.full_name) ||
      null
    if (!full) return null
    // First name only - keeps the next-match card readable on narrow phones
    return full.trim().split(/\s+/)[0] || full
  })()
  const liveMatches = (data.live_matches || []) as Match[]
  const calledMatches = (data.called_matches || []) as Match[]
  const standings = (data.standings || []) as Array<{
    group: string
    standings: Array<{ team_id: string; team_name: string; points: number }>
  }>
  const announcements = (data.announcements || []) as LiveAnnouncement[]
  const myUpcoming = (data.my_upcoming || []) as Match[]
  const myResults = (data.my_results || []) as Match[]
  const drawReady = allMatches.length > 0
  const waitingOnDraw =
    hasPaidEntry &&
    !drawReady &&
    t.status !== 'LIVE' &&
    t.status !== 'COMPLETED' &&
    t.status !== 'CANCELLED'
  const reminderNote = waitingOnDraw ? reminderPromiseCopy(t.event_date) : ''
  const matchDayLive = hasPaidEntry && (t.status === 'LIVE' || drawReady)
  // Only hide venue board when you're actually on court - still show it while waiting to confirm
  const myOnCourt =
    hasPaidEntry && next && (next.status === 'LIVE' || next.status === 'CALLED')
  // Pre-start: don't drown “you're in” with empty venue chrome
  const showVenueBoard = !waitingOnDraw && !hasPendingCaptain && !isListedPartner
  const championshipMatches = allMatches.filter((m) => m.stage === 'KNOCKOUT')
  const plateMatches = allMatches.filter((m) => m.stage === 'PLATE')
  const knockoutMatches = [...championshipMatches, ...plateMatches]
  const knockoutActive = isKnockoutActive(allMatches)

  const nextActions: NextActions = {
    onLogScore: () => next && openScoreSheet(next),
    onConfirm: () => next && confirmMut.mutate(next.id),
    onEditPending: () => next && cancelMut.mutate({ matchId: next.id, reopen: true }),
    onRejectPending: () => {
      if (!next) return
      void confirmDialog({
        title: 'Reject this score?',
        message: 'The proposed result will be cleared so either team can enter the score again.',
        confirmLabel: 'Reject score',
        cancelLabel: 'Keep it',
        danger: true,
      }).then((ok) => {
        if (ok) cancelMut.mutate({ matchId: next.id, reopen: false })
      })
    },
    confirming: confirmMut.isPending && confirmMut.variables === next?.id,
    cancelling: cancelMut.isPending && cancelMut.variables?.matchId === next?.id,
  }

  const leaveBtn = canLeave ? (
    <LeaveTournamentButton
      tournamentId={t.id}
      slug={slug}
      paymentStatus={myPayment}
      paymentVia={myPaymentVia}
      teamName={myTeam?.name}
      singles={singles}
      className="btn btn-ghost btn-block"
    />
  ) : null

  return (
    <div className="app-shell">
      <NavBar />
      <main className="pl-page">
        <BackButton fallbackTo={slug ? `/t/${slug}` : '/tournaments'} />
        <header className="pl-header">
          <div className="pl-title-row">
            <h1>{t.name}</h1>
            {liveMatches.length > 0 ? (
              <span className="badge badge-live">
                <span className="live-dot" /> LIVE
              </span>
            ) : calledMatches.length > 0 ? (
              <span className="badge badge-official">Called</span>
            ) : null}
          </div>
          {!myOnCourt && (
            <p className="pl-lead">
              {waitingOnDraw
                ? reminderNote
                  ? `You’re registered. ${reminderNote} Your next court appears here when the draw goes live.`
                  : 'You’re registered. We’ll show your next court here when the draw goes live.'
                : matchDayLive
                  ? 'Next court, opponent, and score - updates live.'
                  : 'Courts, calls, and scores - updates every few seconds.'}
            </p>
          )}
          <SponsorStrip sponsors={sponsors} placement="hero" compact />
          {payNote && (
            <p className="pl-pay-venue" role="status">
              {payNote}
            </p>
          )}
          {owesAtVenue && (
            <p className="pl-pay-venue" role="status">
              Entry fee still due
              {t.entry_fee_cents > 0
                ? ` (${formatMoney(t.entry_fee_cents, t.currency)})`
                : ''}{' '}
              - pay the organiser at the venue
              {(mySlot === 1 || mySlot == null) ? (
                <>
                  {' '}
                  or <Link to={`/t/${slug}/join`}>pay online now</Link>
                </>
              ) : null}
              .
            </p>
          )}
          {dataUpdatedAt > 0 && (
            <p className="pl-updated">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
              {isFetching ? ' · refreshing…' : ''}
            </p>
          )}
        </header>

        <section className="pl-next">
          <h2>
            {waitingOnDraw
              ? 'Waiting for fixtures'
              : hasPaidEntry || hasPendingCaptain || isListedPartner
                ? 'Your next match'
                : !user
                  ? 'Live board'
                  : 'Get on the board'}
          </h2>
          {needsPartner ? (
            <div className="pl-next-card">
              <p className="pl-youre-in-badge">Partner needed</p>
              <p className="pl-empty" style={{ marginBottom: 12 }}>
                Your partner left <strong>{myTeam?.name}</strong>. Add someone new to stay in the
                draw - your entry stays paid.
              </p>
              <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block">
                Add partner
              </Link>
              {leaveBtn}
            </div>
          ) : partnerInvitePending ? (
            <div className="pl-next-card">
              <p className="pl-youre-in-badge">Team invite</p>
              <p className="pl-empty" style={{ marginBottom: 12 }}>
                <strong>{myTeam?.partner_name || 'Your teammate'}</strong> registered your team
                {myTeam?.name ? (
                  <>
                    {' '}
                    (<strong>{myTeam.name}</strong>)
                  </>
                ) : null}
                . They pay for both of you — you just Accept or Decline.
              </p>
              <div className="pl-next-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={partnerInviteMut.isPending}
                  onClick={() => partnerInviteMut.mutate({ tournamentId: t.id, accept: true })}
                >
                  {partnerInviteMut.isPending ? 'Saving…' : 'Accept'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-block pl-btn-on-dark"
                  disabled={partnerInviteMut.isPending}
                  onClick={() => partnerInviteMut.mutate({ tournamentId: t.id, accept: false })}
                >
                  Decline
                </button>
              </div>
              {actionError && <p className="form-error pl-action-error">{actionError}</p>}
            </div>
          ) : hasPendingCaptain ? (
            <div className="pl-next-card">
              <p className="pl-empty" style={{ marginBottom: 12 }}>
                {t.play_format === 'SINGLES'
                  ? 'Your registration is waiting for payment.'
                  : 'You registered the team — finish payment for both players. Your partner is invited and isn’t charged.'}
              </p>
              <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block">
                {t.play_format === 'SINGLES' ? 'Complete payment' : 'Pay for both players'}
              </Link>
              {leaveBtn}
            </div>
          ) : isListedPartner ? (
            <div className="pl-next-card">
              <p className="pl-empty" style={{ marginBottom: 12 }}>
                You’re on <strong>{myTeam?.name}</strong>. Your teammate registered first and still
                needs to finish paying for both of you — you don’t pay separately.
              </p>
              <Link to={`/t/${slug}`} className="btn btn-primary btn-block">
                View tournament
              </Link>
              {leaveBtn}
            </div>
          ) : waitingOnDraw ? (
            <div className="pl-next-card pl-youre-in-card">
              <p className="pl-youre-in-badge">You’re in</p>
              <p className="pl-empty" style={{ marginBottom: 8 }}>
                {myTeam?.name ? (
                  <>
                    <strong>{myTeam.name}</strong>
                    {myTeam.players?.length ? (
                      <span className="pl-youre-in-players"> · {myTeam.players.join(' / ')}</span>
                    ) : null}
                  </>
                ) : (
                  'Your entry is confirmed.'
                )}
              </p>
              <p className="muted-note" style={{ marginBottom: 12 }}>
                Waiting for the draw. This page updates automatically - no need to refresh.
              </p>
              <div className="pl-youre-in-meta">
                <span>{t.venue}</span>
                <span>
                  {formatDate(t.event_date, { day: 'numeric', month: 'short' })} ·{' '}
                  {formatTime(t.start_time)}
                </span>
              </div>
              {leaveBtn}
              <Link to={`/t/${slug}`} className="pl-details-link">
                Tournament details
              </Link>
            </div>
          ) : next && hasPaidEntry ? (
            <>
              <NextMatchCard
                next={next}
                slug={slug}
                myTeamId={myTeamId}
                partnerLabel={partnerLabel}
                actions={nextActions}
              />
              {actionError && <p className="form-error pl-action-error">{actionError}</p>}
              {leaveBtn && <div style={{ marginTop: 12 }}>{leaveBtn}</div>}
            </>
          ) : (
            <div className="pl-next-card pl-next-card--quiet">
              <p className="pl-empty">
                {hasPaidEntry
                  ? t.status === 'COMPLETED'
                    ? 'This tournament is finished. See your results below.'
                    : 'No upcoming matches for you right now.'
                  : !user
                    ? liveMatches.length > 0 || calledMatches.length > 0
                      ? 'Courts and calls update below - no login needed.'
                      : 'Courts and scores will show here when play starts.'
                    : 'Register for this tournament to see your next match here.'}
              </p>
              {!user ? (
                <p className="muted-note" style={{ marginTop: 8, marginBottom: 0 }}>
                  Playing?{' '}
                  <Link to={`/login?next=${encodeURIComponent(`/t/${slug}/live`)}`}>Log in</Link>
                  {' · '}
                  <Link to={`/signup?next=${encodeURIComponent(`/t/${slug}/live`)}`}>Sign up</Link>
                </p>
              ) : !hasPaidEntry && !hasPendingCaptain && !isListedPartner && t.status === 'REGISTRATION_OPEN' ? (
                <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block" style={{ marginTop: 12 }}>
                  Join tournament
                </Link>
              ) : null}
              {leaveBtn}
              <Link to={`/t/${slug}`} className="pl-details-link">
                Full tournament page
              </Link>
            </div>
          )}
        </section>

        {matchDayLive &&
          (myUpcoming.filter((m) => m.id !== next?.id).length > 0 ||
            myResults.length > 0 ||
            standings.length > 0 ||
            knockoutActive) && (
            <nav className="pl-jump" aria-label="Jump to section">
              {myUpcoming.filter((m) => m.id !== next?.id).length > 0 && (
                <a href="#pl-later" className="pl-jump-link">
                  Later
                </a>
              )}
              {myResults.length > 0 && (
                <a href="#pl-results" className="pl-jump-link">
                  Results
                </a>
              )}
              {standings.length > 0 && (
                <a href="#pl-groups" className="pl-jump-link">
                  Groups
                </a>
              )}
              {knockoutActive && knockoutMatches.length > 0 && (
                <a href="#pl-draw" className="pl-jump-link">
                  Draw
                </a>
              )}
              {showVenueBoard && (liveMatches.length > 0 || calledMatches.length > 0) && (
                <a href="#pl-venue" className="pl-jump-link">
                  Courts
                </a>
              )}
            </nav>
          )}

        {hasPaidEntry && myUpcoming.filter((m) => m.id !== next?.id).length > 0 && (
          <section className="pl-block" id="pl-later">
            <h2>Later today</h2>
            <ul className="pl-schedule">
              {myUpcoming
                .filter((m) => m.id !== next?.id)
                .map((m) => {
                  const opp = opponentName(m, myTeamId)
                  return (
                    <li key={m.id} className="pl-sched-row">
                      <div className="pl-sched-court">{courtLabel(m.court_name, m.court_number)}</div>
                      <div className="pl-sched-when">{scheduleWhen(m)}</div>
                      <div className="pl-sched-vs">
                        {opp ? (
                          <>
                            <span className="pl-sched-vs-label">vs</span> {opp}
                          </>
                        ) : (
                          <MatchNames m={m} />
                        )}
                      </div>
                      <div className="pl-sched-round">{knockoutRoundLabel(m.round, m.stage)}</div>
                    </li>
                  )
                })}
            </ul>
          </section>
        )}

        {hasPaidEntry && myResults.length > 0 && (
          <section className="pl-block" id="pl-results">
            <h2>Your results</h2>
            <ul className="pl-results">
              {myResults.map((m) => {
                const won = m.winner_id ? m.winner_id === myTeamId : null
                const mark = won === true ? '✓' : won === false ? '✗' : '·'
                return (
                  <li key={m.id} className={won === true ? 'win' : won === false ? 'loss' : ''}>
                    <span className="pl-result-score">
                      {mark} {formatMatchScore(m.score)}
                    </span>
                    <span className="pl-result-vs">
                      vs{' '}
                      {m.team_a_id === myTeamId
                        ? m.team_b_name || 'Opponent'
                        : m.team_a_name || 'Opponent'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {standings.length > 0 && (
          <div id="pl-groups">
            {standings.map((g) => (
              <section key={g.group} className="pl-block">
                <h2>Group {g.group}</h2>
                <ol className="pl-table">
                  {g.standings.map((row, i) => (
                    <li key={row.team_id} className={row.team_id === myTeamId ? 'me' : ''}>
                      <span className="pos">{i + 1}.</span>
                      <span className="name">{row.team_name}</span>
                      <span className="pts">{row.points} pts</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}

        {knockoutActive && knockoutMatches.length > 0 && (
          <section className="pl-block pl-bracket" id="pl-draw">
            {championshipMatches.length > 0 && (
              <>
                {plateMatches.length > 0 && <h2>Championship</h2>}
                <TournamentBracket matches={championshipMatches} myTeamId={myTeamId} />
              </>
            )}
            {plateMatches.length > 0 && (
              <>
                <h2>Plate</h2>
                <TournamentBracket matches={plateMatches} myTeamId={myTeamId} />
              </>
            )}
          </section>
        )}

        {showVenueBoard && !myOnCourt && (liveMatches.length > 0 || calledMatches.length > 0) && (
          <div id="pl-venue">
            {liveMatches.length > 0 && (
              <section className="pl-block">
                <h2>Live now</h2>
                <ul className="pl-live-list">
                  {liveMatches.map((m) => {
                    const board = formatLiveBoardScore(m.score)
                    return (
                      <li key={m.id}>
                        <div className="pl-live-top">
                          <strong>{courtLabel(m.court_name, m.court_number)}</strong>
                          <span className="pl-live-games">
                            Set {board.set} · {board.games}
                          </span>
                        </div>
                        <span className="pl-live-names">
                          <MatchNames m={m} />
                        </span>
                        {board.sets && <span className="pl-live-sets">Sets {board.sets}</span>}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
            {calledMatches.length > 0 && (
              <section className="pl-block">
                <h2>Called to court</h2>
                <ul className="pl-live-list pl-called-list">
                  {calledMatches.map((m) => (
                    <li key={m.id}>
                      <div className="pl-live-top">
                        <strong>{courtLabel(m.court_name, m.court_number)}</strong>
                        <span className="pl-called-tag">Go now</span>
                      </div>
                      <span className="pl-live-names">
                        <MatchNames m={m} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {announcements.length > 0 && !waitingOnDraw && (
          <section className="pl-block pl-announce">
            <h2>Announcements</h2>
            <ul className="pl-announce-list">
              {announcements.map((a) => (
                <li key={a.id}>
                  <strong>{a.title}</strong>
                  <span>{a.body}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {scoringMatch && (
        <div
          className="score-modal-backdrop"
          onClick={() => {
            setScoringMatch(null)
            setScoreError('')
          }}
        >
          <form
            className="score-modal pl-score-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pl-score-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              setScoreError('')
              const pairs: [number, number][] = [
                [sets.set1_a, sets.set1_b],
                [sets.set2_a, sets.set2_b],
                [sets.set3_a, sets.set3_b],
              ]
              let aSets = 0
              let bSets = 0
              let played = 0
              for (const [a, b] of pairs) {
                if (!(a || b)) continue
                if (a === b) {
                  setScoreError('Set scores can’t be tied')
                  return
                }
                played += 1
                if (a > b) aSets += 1
                else bSets += 1
              }
              if (played < 2) {
                setScoreError('Enter at least two sets (best of 3)')
                return
              }
              if (Math.max(aSets, bSets) < 2) {
                setScoreError('One side needs two sets to win')
                return
              }
              if ((aSets === 2 && bSets === 0) || (bSets === 2 && aSets === 0)) {
                if (sets.set3_a || sets.set3_b) {
                  setScoreError('Clear set 3 when the match finished 2–0')
                  return
                }
              }
              scoreMut.mutate()
            }}
          >
            <h2 id="pl-score-title">Log final score</h2>
            <p className="muted-note" style={{ marginTop: 0 }}>
              Best of 3. Opponent confirms before it counts.
            </p>
            <div className="score-sides-label">
              <div>
                <span className="muted-note">
                  {scoringMatch.team_a_id === myTeamId ? 'You' : 'Opponent'}
                </span>
                <strong>{scoringMatch.team_a_name || 'Team A'}</strong>
              </div>
              <div>
                <span className="muted-note">
                  {scoringMatch.team_b_id === myTeamId ? 'You' : 'Opponent'}
                </span>
                <strong>{scoringMatch.team_b_name || 'Team B'}</strong>
              </div>
            </div>
            <div className="score-grid">
              {(
                [
                  ['set1_a', 'set1_b', 'Set 1'],
                  ['set2_a', 'set2_b', 'Set 2'],
                  ...(sets.set3_a > 0 ||
                  sets.set3_b > 0 ||
                  (sets.set1_a !== sets.set1_b &&
                    sets.set2_a !== sets.set2_b &&
                    (sets.set1_a > sets.set1_b) !== (sets.set2_a > sets.set2_b))
                    ? ([['set3_a', 'set3_b', 'Set 3']] as const)
                    : []),
                ] as const
              ).map(([ka, kb, label]) => {
                const isDecider = label === 'Set 3'
                const maxGames = isDecider ? 15 : 7
                return (
                  <div key={label} className="form-group pl-score-row">
                    <label>{isDecider ? 'Set 3 / TB' : label}</label>
                    <div className="score-pair pl-score-pair">
                      <ScoreStep
                        label={`${label} left`}
                        value={sets[ka]}
                        max={maxGames}
                        onChange={(n) => setSets((s) => ({ ...s, [ka]: n }))}
                      />
                      <span className="pl-score-dash">–</span>
                      <ScoreStep
                        label={`${label} right`}
                        value={sets[kb]}
                        max={maxGames}
                        onChange={(n) => setSets((s) => ({ ...s, [kb]: n }))}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            {scoreError && <p className="form-error">{scoreError}</p>}
            <div className="form-actions pl-score-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={scoreMut.isPending}>
                {scoreMut.isPending ? 'Sending…' : 'Submit for confirm'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => {
                  setScoringMatch(null)
                  setScoreError('')
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
