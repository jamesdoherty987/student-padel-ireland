import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import LeaveTournamentButton from '../components/LeaveTournamentButton'
import NavBar from '../components/NavBar'
import NumberInput from '../components/NumberInput'
import { apiErrorMessage, tournamentApi, type Match } from '../services/api'
import { formatLiveBoardScore, formatMatchScore, formatTime, courtLabel } from '../utils/format'
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

function roundLabel(round: string, stage?: string) {
  if (!round) return stage === 'KNOCKOUT' ? 'Knockout' : 'Match'
  if (round.startsWith('GROUP_')) return `Group ${round.replace('GROUP_', '')}`
  const map: Record<string, string> = {
    R16: 'Round of 16',
    QF: 'Quarter-final',
    SF: 'Semi-final',
    FINAL: 'Final',
    BRONZE: '3rd place',
  }
  return map[round] || round.replace(/_/g, ' ')
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
  return formatTime(m.scheduled_start)
}

type NextActions = {
  onLogScore: () => void
  onConfirm: () => void
  onCancelPending: () => void
  confirming: boolean
  cancelling: boolean
}

function NextMatchCard({
  next,
  slug,
  myTeamId,
  actions,
}: {
  next: Match
  slug: string
  myTeamId?: string
  actions: NextActions
}) {
  const board = next.status === 'LIVE' ? formatLiveBoardScore(next.score) : null
  const opp = opponentName(next, myTeamId)
  const mine = mySideName(next, myTeamId)
  const court = courtLabel(next.court_name, next.court_number)
  const when =
    next.status === 'CALLED'
      ? 'Called to court'
      : next.status === 'LIVE'
        ? 'Playing now'
        : next.status === 'AWAITING_CONFIRM'
          ? 'Waiting for confirmation'
          : formatTime(next.scheduled_start)

  return (
    <div
      className={`pl-next-card ${next.status === 'CALLED' ? 'is-called' : ''} ${next.status === 'LIVE' ? 'is-live' : ''} ${next.status === 'AWAITING_CONFIRM' ? 'is-pending' : ''}`}
    >
      {next.status === 'CALLED' && <p className="pl-go-now">Go to court now</p>}
      {next.status === 'LIVE' && <p className="pl-go-now">Your match is live</p>}
      {next.status === 'AWAITING_CONFIRM' && next.needs_my_confirm && (
        <p className="pl-go-now">Confirm this score</p>
      )}
      {next.status === 'AWAITING_CONFIRM' && next.score_submitted_by_me && (
        <p className="pl-go-now pl-go-now--soft">Waiting on opponent</p>
      )}

      <p className="pl-round">{roundLabel(next.round, next.stage)}</p>
      <div className="pl-court">{court}</div>
      <div className="pl-time">{when}</div>

      {opp ? (
        <div className="pl-vs pl-vs--you">
          <div className="pl-side">
            <span className="pl-side-label">You</span>
            <strong>{mine}</strong>
          </div>
          <span className="pl-vs-sep">VS</span>
          <div className="pl-side">
            <span className="pl-side-label">Opponent</span>
            <strong>{opp}</strong>
          </div>
        </div>
      ) : (
        <div className="pl-vs">
          <div>{next.team_a_name || next.team_a_placeholder || 'TBD'}</div>
          <span>VS</span>
          <div>{next.team_b_name || next.team_b_placeholder || 'TBD'}</div>
        </div>
      )}

      {board && (
        <p className="pl-next-score">
          Set {board.set} · {board.games}
          {board.sets ? ` · Sets ${board.sets}` : ''}
        </p>
      )}

      {next.status === 'AWAITING_CONFIRM' && next.score && (
        <p className="pl-next-score">Proposed · {formatMatchScore(next.score)}</p>
      )}

      <div className="pl-next-actions">
        {next.needs_my_confirm ? (
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={actions.confirming}
            onClick={actions.onConfirm}
          >
            {actions.confirming ? 'Confirming…' : 'Confirm score'}
          </button>
        ) : next.can_i_score ? (
          <button type="button" className="btn btn-primary btn-block" onClick={actions.onLogScore}>
            Log final score
          </button>
        ) : null}
        {next.score_submitted_by_me && next.status === 'AWAITING_CONFIRM' && (
          <>
            <p className="pl-pending-hint">The other team needs to confirm before this counts.</p>
            <button
              type="button"
              className="btn btn-ghost btn-block pl-btn-on-dark"
              disabled={actions.cancelling}
              onClick={actions.onCancelPending}
            >
              {actions.cancelling ? 'Cancelling…' : 'Edit / cancel score'}
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
  const qc = useQueryClient()
  const [scoringMatch, setScoringMatch] = useState<Match | null>(null)
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

  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['player-view', slug],
    queryFn: async () => (await tournamentApi.playerView(slug)).data,
    enabled: !!slug,
    retry: 4,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 10000),
    refetchInterval: (query) => (query.state.status === 'error' ? 5000 : 8000),
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['player-view', slug] })
  }

  useEffect(() => {
    if (!scoringMatch) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.classList.add('modal-open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setScoringMatch(null)
        setScoreError('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.documentElement.classList.remove('modal-open')
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
    mutationFn: async (matchId: string) => (await tournamentApi.cancelPendingScore(matchId)).data,
    onSuccess: (m) => {
      setActionError('')
      invalidate()
      openScoreSheet(m)
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
        <main className="pl-page empty-state">
          <p>Could not load the live board.</p>
          <p className="muted-note" style={{ marginTop: 8 }}>
            The server may be waking up. Wait a few seconds and try again.
          </p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying…' : 'Retry'}
            </button>
            <Link to="/tournaments" className="btn btn-ghost">
              Events
            </Link>
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
    slot?: number | null
    can_leave?: boolean
  } | null
  const myPayment = myTeam?.payment_status
  const mySlot = myTeam?.slot ?? null
  const hasPaidEntry = !!myTeam && myPayment === 'PAID'
  const hasPendingCaptain = !!myTeam && myPayment === 'PENDING' && mySlot === 1
  const isListedPartner = !!myTeam && myPayment === 'PENDING' && mySlot !== 1
  const canLeave = !!myTeam?.can_leave
  const singles = t.play_format === 'SINGLES'
  const myTeamId = hasPaidEntry ? myTeam?.id : undefined
  const liveMatches = (data.live_matches || []) as Match[]
  const calledMatches = (data.called_matches || []) as Match[]
  const standings = (data.standings || []) as Array<{
    group: string
    standings: Array<{ team_id: string; team_name: string; points: number }>
  }>
  const announcements = (data.announcements || []) as LiveAnnouncement[]
  const myUpcoming = (data.my_upcoming || []) as Match[]
  const myResults = (data.my_results || []) as Match[]
  const boardQuiet = liveMatches.length === 0 && calledMatches.length === 0
  // Only hide venue board when you're actually on court — still show it while waiting to confirm
  const myOnCourt =
    hasPaidEntry && next && (next.status === 'LIVE' || next.status === 'CALLED')

  const nextActions: NextActions = {
    onLogScore: () => next && openScoreSheet(next),
    onConfirm: () => next && confirmMut.mutate(next.id),
    onCancelPending: () => next && cancelMut.mutate(next.id),
    confirming: confirmMut.isPending && confirmMut.variables === next?.id,
    cancelling: cancelMut.isPending && cancelMut.variables === next?.id,
  }

  const leaveBtn = canLeave ? (
    <LeaveTournamentButton
      tournamentId={t.id}
      slug={slug}
      paymentStatus={myPayment}
      teamName={myTeam?.name}
      singles={singles}
      className="btn btn-ghost btn-block"
    />
  ) : null

  return (
    <div className="app-shell">
      <NavBar />
      <main className="pl-page">
        <header className="pl-header">
          <BrandLogo to="/tournaments" className="pl-brand" size="sm" />
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
          <p className="pl-lead">
            {hasPaidEntry
              ? 'Your next court, opponent, and score — updated live.'
              : 'Courts, calls, and scores — updates every few seconds.'}
          </p>
          {dataUpdatedAt > 0 && (
            <p className="pl-updated">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
              {isFetching ? ' · refreshing…' : ''}
            </p>
          )}
        </header>

        <section className="pl-next">
          <h2>Your next match</h2>
          {hasPendingCaptain ? (
            <div className="pl-next-card">
              <p className="pl-empty" style={{ marginBottom: 12 }}>
                Your registration is waiting for payment.
              </p>
              <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block">
                Complete payment
              </Link>
              {leaveBtn}
            </div>
          ) : isListedPartner ? (
            <div className="pl-next-card">
              <p className="pl-empty" style={{ marginBottom: 12 }}>
                You’re listed as a partner on <strong>{myTeam?.name}</strong>. Your teammate needs to
                finish payment — you can’t pay separately.
              </p>
              <Link to={`/t/${slug}`} className="btn btn-primary btn-block">
                View tournament
              </Link>
              {leaveBtn}
            </div>
          ) : next && hasPaidEntry ? (
            <>
              <NextMatchCard next={next} slug={slug} myTeamId={myTeamId} actions={nextActions} />
              {actionError && <p className="form-error pl-action-error">{actionError}</p>}
              {leaveBtn && <div style={{ marginTop: 12 }}>{leaveBtn}</div>}
            </>
          ) : (
            <div className="pl-next-card pl-next-card--quiet">
              <p className="pl-empty">
                {hasPaidEntry
                  ? 'No upcoming matches scheduled yet.'
                  : 'Register for this tournament to see your next match here.'}
              </p>
              {!hasPaidEntry && !hasPendingCaptain && !isListedPartner && t.status === 'REGISTRATION_OPEN' && (
                <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block" style={{ marginTop: 12 }}>
                  Join tournament
                </Link>
              )}
              {leaveBtn}
              <Link to={`/t/${slug}`} className="pl-details-link">
                Full tournament page
              </Link>
            </div>
          )}
        </section>

        {!myOnCourt && liveMatches.length > 0 && (
          <section className="pl-block pl-block--first">
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

        {!myOnCourt && calledMatches.length > 0 && (
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

        {boardQuiet && !hasPaidEntry && (
          <section className="pl-block pl-block--first">
            <h2>On court</h2>
            <p className="pl-empty">No matches are live or called right now.</p>
          </section>
        )}

        {announcements.length > 0 && (
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

        {hasPaidEntry && myUpcoming.length > 0 && (
          <section className="pl-block">
            <h2>Your schedule</h2>
            <ul className="pl-schedule">
              {myUpcoming.map((m, i) => {
                const opp = opponentName(m, myTeamId)
                return (
                  <li key={m.id} className={i === 0 ? 'is-next' : ''}>
                    <strong>{courtLabel(m.court_name, m.court_number)}</strong>
                    <span>{scheduleWhen(m)}</span>
                    <span>
                      {opp ? (
                        <>
                          vs {opp}
                          <span className="pl-sched-round"> · {roundLabel(m.round, m.stage)}</span>
                        </>
                      ) : (
                        <MatchNames m={m} />
                      )}
                    </span>
                    <div className="pl-sched-actions">
                      {m.needs_my_confirm && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={confirmMut.isPending && confirmMut.variables === m.id}
                          onClick={() => confirmMut.mutate(m.id)}
                        >
                          {confirmMut.isPending && confirmMut.variables === m.id
                            ? 'Confirming…'
                            : 'Confirm score'}
                        </button>
                      )}
                      {m.can_i_score && (
                        <button type="button" className="btn btn-dark btn-sm" onClick={() => openScoreSheet(m)}>
                          Log score
                        </button>
                      )}
                      {m.score_submitted_by_me && m.status === 'AWAITING_CONFIRM' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={cancelMut.isPending && cancelMut.variables === m.id}
                          onClick={() => cancelMut.mutate(m.id)}
                        >
                          Edit score
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {actionError && <p className="form-error">{actionError}</p>}
          </section>
        )}

        {hasPaidEntry && (
          <section className="pl-block">
            <h2>Your results</h2>
            {myResults.length === 0 ? (
              <p className="pl-empty">No results yet.</p>
            ) : (
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
            )}
          </section>
        )}

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

        {standings.length === 0 && (
          <section className="pl-block">
            <h2>Standings</h2>
            <p className="pl-empty">Groups appear after the organiser generates the tournament.</p>
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
            className="score-modal"
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
              for (const [a, b] of pairs) {
                if (!(a || b)) continue
                if (a > b) aSets += 1
                else if (b > a) bSets += 1
              }
              if (aSets === bSets) {
                setScoreError('Enter decisive set scores so there is a winner')
                return
              }
              scoreMut.mutate()
            }}
          >
            <h2 id="pl-score-title">Log final score</h2>
            <p className="muted-note" style={{ marginTop: 0 }}>
              The other team will confirm this before the match is finished.
            </p>
            <div className="score-sides-label">
              <div>
                <span className="muted-note">
                  {scoringMatch.team_a_id === myTeamId ? 'You' : 'Side A'}
                </span>
                <strong>{scoringMatch.team_a_name || 'Team A'}</strong>
              </div>
              <div>
                <span className="muted-note">
                  {scoringMatch.team_b_id === myTeamId ? 'You' : 'Side B'}
                </span>
                <strong>{scoringMatch.team_b_name || 'Team B'}</strong>
              </div>
            </div>
            <div className="score-grid">
              {(
                [
                  ['set1_a', 'set1_b', 'Set 1'],
                  ['set2_a', 'set2_b', 'Set 2'],
                  ['set3_a', 'set3_b', 'Set 3 (if needed)'],
                ] as const
              ).map(([ka, kb, label]) => (
                <div key={label} className="form-group">
                  <label>{label}</label>
                  <div className="score-pair">
                    <NumberInput
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      max={7}
                      emptyValue={0}
                      value={sets[ka]}
                      onValueChange={(n) =>
                        setSets((s) => ({ ...s, [ka]: Math.max(0, Math.min(7, Math.trunc(n))) }))
                      }
                      aria-label={`${label} side A`}
                    />
                    <span>-</span>
                    <NumberInput
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      max={7}
                      emptyValue={0}
                      value={sets[kb]}
                      onValueChange={(n) =>
                        setSets((s) => ({ ...s, [kb]: Math.max(0, Math.min(7, Math.trunc(n))) }))
                      }
                      aria-label={`${label} side B`}
                    />
                  </div>
                </div>
              ))}
            </div>
            {scoreError && <p className="form-error">{scoreError}</p>}
            <div className="form-actions">
              <button type="submit" className="btn btn-dark" disabled={scoreMut.isPending}>
                {scoreMut.isPending ? 'Sending…' : 'Submit for confirm'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setScoringMatch(null)
                  setScoreError('')
                }}
              >
                Back
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
