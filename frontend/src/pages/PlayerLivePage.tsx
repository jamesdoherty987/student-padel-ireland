import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import BackButton from '../components/BackButton'
import LeaveTournamentButton from '../components/LeaveTournamentButton'
import NavBar from '../components/NavBar'
import ScoreStep from '../components/ScoreStep'
import SponsorStrip from '../components/SponsorStrip'
import TournamentBracket from '../components/TournamentBracket'
import '../components/ScoreSheet.css'
import { useAuth } from '../context/AuthContext'
import { scrollFieldAboveKeyboard, useKeyboardInset } from '../hooks/useKeyboardInset'
import { hapticLight, hapticSuccess } from '../native/haptics'
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

/** Normalize tournament scoring mode. Missing/unknown → treat as SIMPLE UI. */
function tournamentScoringMode(raw?: string | null): 'SIMPLE' | 'BEST_OF_3' | 'LEGACY' {
  const mode = (raw || '').trim().toUpperCase()
  if (mode === 'BEST_OF_3') return 'BEST_OF_3'
  if (mode === 'SIMPLE') return 'SIMPLE'
  // API older than scoring_mode always required two sets for player-score
  if (!mode) return 'LEGACY'
  return 'SIMPLE'
}

/**
 * Build player-score body for the active API.
 * LEGACY (no scoring_mode on tournament): synthesize a 2–0 set win from
 * winner + optional overall points so old backends accept the result.
 */
function playerScorePayload(
  scoringMode: 'SIMPLE' | 'BEST_OF_3' | 'LEGACY',
  sets: ScoreSets,
  winnerId: string,
  teamAId: string | null | undefined,
  teamBId: string | null | undefined,
) {
  if (scoringMode === 'BEST_OF_3') return { ...sets }

  if (scoringMode === 'SIMPLE') {
    return {
      set1_a: sets.set1_a,
      set1_b: sets.set1_b,
      set2_a: 0,
      set2_b: 0,
      set3_a: 0,
      set3_b: 0,
      winner_id: winnerId || null,
    }
  }

  const aWins = !!winnerId && winnerId === teamAId
  const bWins = !!winnerId && winnerId === teamBId
  let s1a = sets.set1_a
  let s1b = sets.set1_b
  if (!(s1a || s1b)) {
    s1a = aWins ? 6 : 4
    s1b = aWins ? 4 : 6
  } else if (aWins && s1a <= s1b) {
    s1a = Math.max(s1b + 2, 6)
  } else if (bWins && s1b <= s1a) {
    s1b = Math.max(s1a + 2, 6)
  }
  return {
    set1_a: s1a,
    set1_b: s1b,
    set2_a: aWins ? 6 : 4,
    set2_b: aWins ? 4 : 6,
    set3_a: 0,
    set3_b: 0,
  }
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
  onDisagree: () => void
  confirming: boolean
  cancelling: boolean
}

function proposedWinnerLabel(m: Match, myTeamId?: string) {
  if (!m.winner_id) return null
  if (myTeamId && m.winner_id === myTeamId) return 'You won'
  if (myTeamId && (m.team_a_id === myTeamId || m.team_b_id === myTeamId)) return 'They won'
  if (m.winner_id === m.team_a_id) return m.team_a_name || 'Team A'
  if (m.winner_id === m.team_b_id) return m.team_b_name || 'Team B'
  return null
}

type PlayerFate = {
  tone: 'champion' | 'runner' | 'out' | 'wait'
  title: string
  body: string
}

function resolvePlayerFate(opts: {
  myTeamId?: string
  myResults: Match[]
  allMatches: Match[]
  groupsDone: boolean
  tournamentDone: boolean
}): PlayerFate | null {
  const { myTeamId, myResults, allMatches, groupsDone, tournamentDone } = opts
  if (!myTeamId) return null

  const mine = (m: Match) => m.team_a_id === myTeamId || m.team_b_id === myTeamId
  const won = (m: Match) => m.winner_id === myTeamId
  const lost = (m: Match) => !!m.winner_id && m.winner_id !== myTeamId && mine(m)

  const champFinal = allMatches.find((m) => m.stage === 'KNOCKOUT' && m.round === 'FINAL')
  const plateFinal = allMatches.find((m) => m.stage === 'PLATE' && m.round === 'FINAL')

  if (champFinal && mine(champFinal) && (champFinal.status === 'COMPLETED' || champFinal.status === 'WALKOVER')) {
    if (won(champFinal)) {
      return {
        tone: 'champion',
        title: 'Champions',
        body: 'You won the tournament. Celebrate — then check the bracket below.',
      }
    }
    return {
      tone: 'runner',
      title: 'Runners-up',
      body: 'You reached the final. Huge run — see the full bracket below.',
    }
  }

  if (plateFinal && mine(plateFinal) && (plateFinal.status === 'COMPLETED' || plateFinal.status === 'WALKOVER')) {
    if (won(plateFinal)) {
      return {
        tone: 'champion',
        title: 'Plate champions',
        body: 'You won the plate. Great recovery — see results below.',
      }
    }
    return {
      tone: 'runner',
      title: 'Plate runners-up',
      body: 'You reached the plate final. See your results below.',
    }
  }

  const myKo = allMatches.filter(
    (m) =>
      mine(m) &&
      (m.stage === 'KNOCKOUT' || m.stage === 'PLATE') &&
      (m.status === 'COMPLETED' || m.status === 'WALKOVER'),
  )
  const lastLoss = [...myKo].reverse().find(lost)
  if (lastLoss) {
    const path = lastLoss.stage === 'PLATE' ? 'plate' : 'championship'
    return {
      tone: 'out',
      title: 'You’re out',
      body: `Knocked out in the ${path} ${knockoutRoundLabel(lastLoss.round, lastLoss.stage).toLowerCase()}. Your results stay below.`,
    }
  }

  const inKoDraw = allMatches.some(
    (m) =>
      mine(m) &&
      (m.stage === 'KNOCKOUT' || m.stage === 'PLATE') &&
      (m.team_a_id === myTeamId || m.team_b_id === myTeamId),
  )
  if (groupsDone && !inKoDraw && myResults.length > 0) {
    return {
      tone: 'out',
      title: 'You’re out',
      body: 'Group stage is done and you didn’t advance. Thanks for playing — results are below.',
    }
  }

  if (tournamentDone) {
    return {
      tone: 'out',
      title: 'Tournament finished',
      body: 'This event is complete. See your results and the bracket below.',
    }
  }

  if (groupsDone && inKoDraw) {
    return {
      tone: 'wait',
      title: 'Waiting on the draw',
      body: 'You’re through. Your next knockout match will show here when it’s set.',
    }
  }

  return {
    tone: 'wait',
    title: 'No match right now',
    body: 'You’re between matches. We’ll show your next court here when it’s ready.',
  }
}

function FateCard({ fate }: { fate: PlayerFate }) {
  return (
    <div className={`pl-next-card pl-fate pl-fate--${fate.tone}`} role="status">
      <p className="pl-fate-kicker">
        {fate.tone === 'champion'
          ? 'Result'
          : fate.tone === 'runner'
            ? 'Result'
            : fate.tone === 'out'
              ? 'End of run'
              : 'Status'}
      </p>
      <h3 className="pl-fate-title">{fate.title}</h3>
      <p className="pl-fate-body">{fate.body}</p>
    </div>
  )
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
  const pending = next.status === 'AWAITING_CONFIRM'
  const scoreText =
    next.score && formatMatchScore(next.score) !== '-' ? formatMatchScore(next.score) : null
  const winnerText = proposedWinnerLabel(next, myTeamId)

  return (
    <div
      className={`pl-next-card pl-next-card--glance ${next.status === 'CALLED' ? 'is-called' : ''} ${next.status === 'LIVE' ? 'is-live' : ''} ${pending ? 'is-pending' : ''}`}
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

      {board && (board.games !== '0-0' || board.sets) ? (
        <p className="pl-next-score">
          {board.sets && board.sets.includes('  ')
            ? `Sets ${board.sets}`
            : board.sets || board.games}
        </p>
      ) : null}

      {pending && (
        <div className="pl-propose" role="status">
          <span className="pl-propose-label">
            {next.needs_my_confirm
              ? 'Opponent entered'
              : next.score_submitted_by_me
                ? 'You entered'
                : 'Proposed result'}
          </span>
          {winnerText ? <strong className="pl-propose-winner">{winnerText}</strong> : null}
          <span className="pl-propose-score">{scoreText || 'Winner only · no score'}</span>
        </div>
      )}


      <div className="pl-next-actions">
        {next.needs_my_confirm ? (
          <>
            <p className="pl-pending-hint">Looks right?</p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={actions.confirming || actions.cancelling}
              onClick={actions.onConfirm}
            >
              {actions.confirming ? '…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block pl-btn-on-dark"
              disabled={actions.cancelling || actions.confirming}
              onClick={actions.onDisagree}
            >
              {actions.cancelling ? '…' : 'Fix'}
            </button>
          </>
        ) : next.score_submitted_by_me && pending ? (
          <>
            <p className="pl-pending-hint">Waiting on them.</p>
            <button
              type="button"
              className="btn btn-ghost btn-block pl-btn-on-dark"
              disabled={actions.cancelling}
              onClick={actions.onEditPending}
            >
              {actions.cancelling ? '…' : 'Edit'}
            </button>
          </>
        ) : next.can_i_score ? (
          <button type="button" className="btn btn-primary btn-block" onClick={actions.onLogScore}>
            Score
          </button>
        ) : null}
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
  const [scoreSheetMode, setScoreSheetMode] = useState<'log' | 'fix' | 'edit'>('log')
  const [payNote, setPayNote] = useState('')
  const [sets, setSets] = useState<ScoreSets>({
    set1_a: 0,
    set1_b: 0,
    set2_a: 0,
    set2_b: 0,
    set3_a: 0,
    set3_b: 0,
  })
  const [winnerId, setWinnerId] = useState('')
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
    refetchInterval: (query) => (query.state.status === 'error' ? 4000 : 5000),
  })

  const { data: allMatches = [] } = useQuery({
    queryKey: ['matches', slug],
    queryFn: async () => (await tournamentApi.matches(slug)).data,
    enabled: !!slug,
    refetchInterval: 8000,
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
        setScoreSheetMode('log')
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
      const mode = tournamentScoringMode(data?.tournament?.scoring_mode)
      const payload = playerScorePayload(
        mode,
        sets,
        winnerId,
        scoringMatch.team_a_id,
        scoringMatch.team_b_id,
      )
      return (await tournamentApi.playerSubmitScore(scoringMatch.id, payload)).data
    },
    onMutate: () => {
      void hapticSuccess()
      const closed = scoringMatch
      const closedMode = scoreSheetMode
      const closedSets = { ...sets }
      const closedWinner = winnerId
      // Close sheet immediately — don't wait on Render/API latency
      setScoringMatch(null)
      setScoreSheetMode('log')
      setScoreError('')
      setActionError('')
      return { closed, closedMode, closedSets, closedWinner }
    },
    onSuccess: () => {
      invalidate()
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.closed) {
        setScoringMatch(ctx.closed)
        setScoreSheetMode(ctx.closedMode)
        setSets(ctx.closedSets)
        setWinnerId(ctx.closedWinner)
      }
      setScoreError(apiErrorMessage(err))
    },
  })

  const confirmMut = useMutation({
    mutationFn: async (matchId: string) => (await tournamentApi.confirmScore(matchId)).data,
    onMutate: () => {
      void hapticSuccess()
      setActionError('')
    },
    onSuccess: (m) => {
      // Patch live board immediately with the confirmed match
      qc.setQueryData(['player-view', slug], (old: unknown) => {
        if (!old || typeof old !== 'object') return old
        const view = old as {
          next_match?: Match | null
          my_upcoming?: Match[]
          my_results?: Match[]
        }
        const upcoming = (view.my_upcoming || []).filter((x) => x.id !== m.id)
        return {
          ...view,
          next_match: upcoming[0] || null,
          my_upcoming: upcoming,
          my_results: [m, ...(view.my_results || [])],
        }
      })
      invalidate()
    },
    onError: (err) => setActionError(apiErrorMessage(err)),
  })

  const cancelMut = useMutation({
    mutationFn: async ({
      matchId,
      reopen,
      mode,
      draft,
    }: {
      matchId: string
      reopen: boolean
      mode: 'fix' | 'edit'
      draft?: { winner_id: string; sets: ScoreSets }
    }) => {
      const m = (await tournamentApi.cancelPendingScore(matchId)).data
      return { m, reopen, mode, draft }
    },
    onMutate: () => {
      void hapticLight()
    },
    onSuccess: ({ m, reopen, mode, draft }) => {
      setActionError('')
      invalidate()
      if (reopen) {
        openScoreSheet(m, {
          mode,
          winner_id: draft?.winner_id,
          sets: draft?.sets,
        })
      }
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

  const openScoreSheet = (
    m: Match,
    opts?: { mode?: 'log' | 'fix' | 'edit'; winner_id?: string; sets?: ScoreSets },
  ) => {
    setScoreError('')
    setActionError('')
    setScoreSheetMode(opts?.mode || 'log')
    setWinnerId(opts?.winner_id ?? m.winner_id ?? '')
    setSets(
      opts?.sets || {
        set1_a: m.score?.set1_a ?? 0,
        set1_b: m.score?.set1_b ?? 0,
        set2_a: m.score?.set2_a ?? 0,
        set2_b: m.score?.set2_b ?? 0,
        set3_a: m.score?.set3_a ?? 0,
        set3_b: m.score?.set3_b ?? 0,
      },
    )
    setScoringMatch(m)
  }

  const pendingDraft = (m: Match) => ({
    winner_id: m.winner_id || '',
    sets: {
      set1_a: m.score?.set1_a ?? 0,
      set1_b: m.score?.set1_b ?? 0,
      set2_a: m.score?.set2_a ?? 0,
      set2_b: m.score?.set2_b ?? 0,
      set3_a: m.score?.set3_a ?? 0,
      set3_b: m.score?.set3_b ?? 0,
    },
  })

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
  const groupsDone =
    drawReady &&
    allMatches.some((m) => m.stage === 'GROUP') &&
    allMatches
      .filter((m) => m.stage === 'GROUP')
      .every((m) => m.status === 'COMPLETED' || m.status === 'WALKOVER' || m.status === 'CANCELLED')
  const playerFate =
    hasPaidEntry && !next && matchDayLive
      ? resolvePlayerFate({
          myTeamId,
          myResults,
          allMatches,
          groupsDone,
          tournamentDone: t.status === 'COMPLETED',
        })
      : null

  const nextActions: NextActions = {
    onLogScore: () => next && openScoreSheet(next, { mode: 'log' }),
    onConfirm: () => next && confirmMut.mutate(next.id),
    onEditPending: () =>
      next &&
      cancelMut.mutate({
        matchId: next.id,
        reopen: true,
        mode: 'edit',
        draft: pendingDraft(next),
      }),
    onDisagree: () =>
      next &&
      cancelMut.mutate({
        matchId: next.id,
        reopen: true,
        mode: 'fix',
        draft: pendingDraft(next),
      }),
    confirming: confirmMut.isPending && confirmMut.variables === next?.id,
    cancelling: cancelMut.isPending && cancelMut.variables?.matchId === next?.id,
  }

  const leaveBtn = canLeave ? (
    <LeaveTournamentButton
      tournamentId={t.id}
      slug={slug}
      paymentStatus={myPayment}
      paymentVia={myPaymentVia}
      refundsOnWithdrawal={t.refunds_on_withdrawal !== false}
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
          {!myOnCourt && waitingOnDraw && (
            <p className="pl-lead">
              {reminderNote
                ? `${reminderNote} Your next court shows here when play starts.`
                : 'Your next court shows here when play starts.'}
            </p>
          )}
          {!myOnCourt && matchDayLive && (
            <p className="pl-lead">Your next match updates live.</p>
          )}
          {sponsors.length > 0 ? (
            <SponsorStrip sponsors={sponsors} placement="hero" compact />
          ) : null}
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
              - pay at the desk at the venue
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
              : playerFate
                ? playerFate.tone === 'champion' || playerFate.tone === 'runner'
                  ? 'Your result'
                  : playerFate.tone === 'out'
                    ? 'Your run'
                    : 'Your status'
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
                . They pay for both of you - you just Accept or Decline.
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
                  : 'You registered the team - finish payment for both players. Your partner is invited and isn’t charged.'}
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
                needs to finish paying for both of you - you don’t pay separately.
              </p>
              <Link to={`/t/${slug}`} className="btn btn-primary btn-block">
                View tournament
              </Link>
              {leaveBtn}
            </div>
          ) : waitingOnDraw ? (
            <div className="pl-next-card pl-next-card--quiet">
              <p className="pl-empty" style={{ marginBottom: 8 }}>
                {myTeam?.name ? (
                  <>
                    Registered as <strong>{myTeam.name}</strong>
                    {myTeam.players?.length ? (
                      <span className="pl-youre-in-players"> · {myTeam.players.join(' / ')}</span>
                    ) : null}
                  </>
                ) : (
                  'You’re registered.'
                )}
              </p>
              <p className="muted-note" style={{ marginBottom: 12 }}>
                Your next court appears here when play starts.
              </p>
              <div className="pl-youre-in-meta">
                <span>{t.venue}</span>
                <span>
                  {formatDate(t.event_date, { day: 'numeric', month: 'short' })} ·{' '}
                  {formatTime(t.start_time)}
                </span>
              </div>
              {leaveBtn}
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
          ) : playerFate ? (
            <>
              <FateCard fate={playerFate} />
              {leaveBtn && <div style={{ marginTop: 12 }}>{leaveBtn}</div>}
              <Link to={`/t/${slug}`} className="pl-details-link">
                Full tournament page
              </Link>
            </>
          ) : (
            <div className="pl-next-card pl-next-card--quiet">
              <p className="pl-empty">
                {!user
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
                <button
                  type="button"
                  className="pl-jump-link"
                  onClick={() =>
                    document.getElementById('pl-later')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                >
                  Later
                </button>
              )}
              {myResults.length > 0 && (
                <button
                  type="button"
                  className="pl-jump-link"
                  onClick={() =>
                    document.getElementById('pl-results')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                >
                  Results
                </button>
              )}
              {standings.length > 0 && (
                <button
                  type="button"
                  className="pl-jump-link"
                  onClick={() =>
                    document.getElementById('pl-groups')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                >
                  Groups
                </button>
              )}
              {knockoutActive && knockoutMatches.length > 0 && (
                <button
                  type="button"
                  className="pl-jump-link"
                  onClick={() =>
                    document.getElementById('pl-draw')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                >
                  Draw
                </button>
              )}
              {showVenueBoard && (liveMatches.length > 0 || calledMatches.length > 0) && (
                <button
                  type="button"
                  className="pl-jump-link"
                  onClick={() =>
                    document.getElementById('pl-venue')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                >
                  Courts
                </button>
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
              <TournamentBracket
                matches={championshipMatches}
                myTeamId={myTeamId}
                stage="KNOCKOUT"
              />
            )}
            {plateMatches.length > 0 && (
              <TournamentBracket matches={plateMatches} myTeamId={myTeamId} stage="PLATE" />
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
          className="score-modal-backdrop pl-score-backdrop"
          onClick={() => {
            setScoringMatch(null)
            setScoreSheetMode('log')
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
              const mode = tournamentScoringMode(data?.tournament?.scoring_mode)
              if (mode !== 'BEST_OF_3') {
                if (!winnerId) {
                  setScoreError('Tap who won')
                  return
                }
                if (sets.set1_a === sets.set1_b && (sets.set1_a > 0 || sets.set1_b > 0)) {
                  setScoreError('Score can’t be tied — change it or leave both at 0')
                  return
                }
                scoreMut.mutate()
                return
              }
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
                setScoreError('Enter at least two sets')
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
            <h2 id="pl-score-title">
              {scoreSheetMode === 'fix'
                ? 'Enter the right result'
                : scoreSheetMode === 'edit'
                  ? 'Change your score'
                  : 'Who won?'}
            </h2>
            <p className="muted-note" style={{ marginTop: 0 }}>
              {scoreSheetMode === 'fix'
                ? 'Fix it, then send again.'
                : scoreSheetMode === 'edit'
                  ? 'Update, then send again.'
                  : tournamentScoringMode(data?.tournament?.scoring_mode) === 'BEST_OF_3'
                    ? 'Best of 3 · they confirm'
                    : 'They confirm'}
            </p>
            {tournamentScoringMode(data?.tournament?.scoring_mode) !== 'BEST_OF_3' ? (
              <>
                <p className="muted-note" style={{ marginTop: 0, marginBottom: '0.65rem' }}>
                  Tap the winner. Score optional.
                </p>
                <div className="score-team-grid" role="group" aria-label="Winner and score">
                  <div
                    className={`score-team-card ${
                      winnerId === scoringMatch.team_a_id ? 'is-winner' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="score-team-win"
                      onClick={() => setWinnerId(scoringMatch.team_a_id || '')}
                    >
                      <span className="score-team-win-label">
                        {winnerId === scoringMatch.team_a_id
                          ? 'Winner'
                          : scoringMatch.team_a_id === myTeamId
                            ? 'We won'
                            : 'Tap if won'}
                      </span>
                      <strong>{scoringMatch.team_a_name || 'Team A'}</strong>
                    </button>
                    <div className="score-team-points">
                      <span className="score-team-points-label">
                        {scoringMatch.team_a_id === myTeamId ? 'Your score' : 'Their score'}
                      </span>
                      <ScoreStep
                        label={`${scoringMatch.team_a_name || 'Team A'} score`}
                        value={sets.set1_a}
                        max={99}
                        onChange={(n) => {
                          setSets((s) => ({ ...s, set1_a: n }))
                          if (n > sets.set1_b) setWinnerId(scoringMatch.team_a_id || '')
                          else if (n < sets.set1_b) setWinnerId(scoringMatch.team_b_id || '')
                        }}
                      />
                    </div>
                  </div>
                  <div
                    className={`score-team-card ${
                      winnerId === scoringMatch.team_b_id ? 'is-winner' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="score-team-win"
                      onClick={() => setWinnerId(scoringMatch.team_b_id || '')}
                    >
                      <span className="score-team-win-label">
                        {winnerId === scoringMatch.team_b_id
                          ? 'Winner'
                          : scoringMatch.team_b_id === myTeamId
                            ? 'We won'
                            : 'Tap if won'}
                      </span>
                      <strong>{scoringMatch.team_b_name || 'Team B'}</strong>
                    </button>
                    <div className="score-team-points">
                      <span className="score-team-points-label">
                        {scoringMatch.team_b_id === myTeamId ? 'Your score' : 'Their score'}
                      </span>
                      <ScoreStep
                        label={`${scoringMatch.team_b_name || 'Team B'} score`}
                        value={sets.set1_b}
                        max={99}
                        onChange={(n) => {
                          setSets((s) => ({ ...s, set1_b: n }))
                          if (n > sets.set1_a) setWinnerId(scoringMatch.team_b_id || '')
                          else if (n < sets.set1_a) setWinnerId(scoringMatch.team_a_id || '')
                        }}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
            {scoreError && <p className="form-error">{scoreError}</p>}
            <div className="form-actions pl-score-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={scoreMut.isPending}>
                {scoreMut.isPending
                  ? 'Sending…'
                  : scoreSheetMode === 'fix'
                    ? 'Send corrected score'
                    : scoreSheetMode === 'edit'
                      ? 'Send updated score'
                      : 'Send for confirm'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => {
                  setScoringMatch(null)
                  setScoreSheetMode('log')
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
