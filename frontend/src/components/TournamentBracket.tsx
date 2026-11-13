import { useEffect, useMemo, useRef, useState } from 'react'
import type { Match } from '../services/api'
import {
  formatMatchScore,
  formatTime,
  knockoutRoundBare,
  knockoutRoundOrder,
  knockoutRoundShort,
} from '../utils/format'
import './TournamentBracket.css'

type RoundColumn = {
  round: string
  label: string
  shortLabel: string
  matches: Match[]
}

function teamLabel(name?: string | null, placeholder?: string | null, fallback = 'TBD') {
  return name || placeholder || fallback
}

function sideScore(m: Match, side: 'a' | 'b') {
  if (!m.score) return null
  if (m.status !== 'COMPLETED' && m.status !== 'WALKOVER' && m.status !== 'AWAITING_CONFIRM') {
    return null
  }
  const sets = [
    [m.score.set1_a, m.score.set1_b],
    [m.score.set2_a, m.score.set2_b],
    [m.score.set3_a, m.score.set3_b],
  ]
  let won = 0
  for (const [a, b] of sets) {
    if (!(a || b)) continue
    if (side === 'a' ? a > b : b > a) won += 1
  }
  return won
}

function inferStage(matches: Match[]): 'KNOCKOUT' | 'PLATE' {
  if (matches.some((m) => m.stage === 'PLATE') && !matches.some((m) => m.stage === 'KNOCKOUT')) {
    return 'PLATE'
  }
  return 'KNOCKOUT'
}

function buildRounds(matches: Match[], stage: 'KNOCKOUT' | 'PLATE'): RoundColumn[] {
  const filtered = matches.filter(
    (m) => m.stage === stage && !(stage === 'KNOCKOUT' && m.round === 'BRONZE'),
  )
  const byRound = new Map<string, Match[]>()
  for (const m of filtered) {
    const list = byRound.get(m.round) || []
    list.push(m)
    byRound.set(m.round, list)
  }
  return [...byRound.entries()]
    .sort((a, b) => knockoutRoundOrder(a[0]) - knockoutRoundOrder(b[0]))
    .map(([round, list]) => ({
      round,
      // Bare labels — bracket title already says Championship / Plate
      label: knockoutRoundBare(round),
      shortLabel: knockoutRoundShort(round),
      matches: [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }))
}

function currentRoundIndex(rounds: RoundColumn[]) {
  for (let i = 0; i < rounds.length; i++) {
    const open = rounds[i].matches.some(
      (m) =>
        m.status === 'LIVE' ||
        m.status === 'CALLED' ||
        m.status === 'AWAITING_CONFIRM' ||
        m.status === 'SCHEDULED',
    )
    if (open) return i
  }
  return Math.max(0, rounds.length - 1)
}

function MatchCard({
  match,
  myTeamId,
  onScore,
  scoreOwnMatchesOnly = false,
}: {
  match: Match
  myTeamId?: string
  onScore?: (m: Match) => void
  /** Player live: only their own unfinished matches are tappable. */
  scoreOwnMatchesOnly?: boolean
}) {
  const aMine = !!myTeamId && match.team_a_id === myTeamId
  const bMine = !!myTeamId && match.team_b_id === myTeamId
  const mine = aMine || bMine
  const aWon = !!match.winner_id && match.winner_id === match.team_a_id
  const bWon = !!match.winner_id && match.winner_id === match.team_b_id
  const done = match.status === 'COMPLETED' || match.status === 'WALKOVER'
  const hasWinner = !!match.winner_id
  const aSets = sideScore(match, 'a')
  const bSets = sideScore(match, 'b')
  const showSets = aSets != null && bSets != null && (aSets > 0 || bSets > 0)
  const openForPlay =
    match.status === 'SCHEDULED' ||
    match.status === 'CALLED' ||
    match.status === 'LIVE' ||
    match.status === 'AWAITING_CONFIRM'
  const canScore = (() => {
    if (!onScore || !match.team_a_id || !match.team_b_id) return false
    if (!scoreOwnMatchesOnly) return true
    if (!mine || match.ratings_applied) return false
    if (match.can_i_score || match.needs_my_confirm || match.score_submitted_by_me) return true
    return openForPlay && !done
  })()
  const scoreLabel = scoreOwnMatchesOnly
    ? match.needs_my_confirm
      ? 'Confirm'
      : match.score_submitted_by_me && match.status === 'AWAITING_CONFIRM'
        ? 'Edit'
        : 'Score'
    : match.status === 'AWAITING_CONFIRM'
      ? 'Fix'
      : done
        ? match.ratings_applied
          ? 'Fix'
          : 'Edit'
        : 'Score'

  let statusNote = ''
  if (match.status === 'LIVE') statusNote = 'Live'
  else if (match.status === 'CALLED') statusNote = 'Ready'
  else if (match.status === 'AWAITING_CONFIRM') statusNote = 'Confirming'
  else if (!done && match.scheduled_start) statusNote = formatTime(match.scheduled_start)

  const className = [
    'tb-match',
    match.status === 'LIVE' ? 'is-live' : '',
    match.status === 'CALLED' ? 'is-called' : '',
    aMine || bMine ? 'is-mine' : '',
    done ? 'is-done' : '',
    canScore ? 'is-scorable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const body = (
    <>
      {statusNote || canScore ? (
        <div className="tb-match-meta">
          {match.status === 'LIVE' && <span className="tb-live-dot" aria-hidden />}
          {statusNote ? <span>{statusNote}</span> : <span />}
          {canScore ? <span className="tb-score-chip">{scoreLabel}</span> : null}
        </div>
      ) : null}
      <div
        className={[
          'tb-side',
          aMine ? 'is-me' : '',
          aWon ? 'is-winner' : '',
          done && hasWinner && !aWon ? 'is-out' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="tb-name">{teamLabel(match.team_a_name, match.team_a_placeholder)}</span>
        {showSets ? <span className="tb-sets">{aSets}</span> : null}
      </div>
      <div
        className={[
          'tb-side',
          bMine ? 'is-me' : '',
          bWon ? 'is-winner' : '',
          done && hasWinner && !bWon ? 'is-out' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="tb-name">{teamLabel(match.team_b_name, match.team_b_placeholder)}</span>
        {showSets ? <span className="tb-sets">{bSets}</span> : null}
      </div>
      {match.status === 'AWAITING_CONFIRM' && match.score ? (
        <p className="tb-scoreline">Proposed · {formatMatchScore(match.score)}</p>
      ) : null}
      {done && match.score && !showSets ? (
        <p className="tb-scoreline">{formatMatchScore(match.score)}</p>
      ) : null}
      {!canScore && !match.team_a_id && !match.team_b_id ? (
        <p className="tb-scoreline">Waiting for previous round</p>
      ) : null}
    </>
  )

  if (canScore && onScore) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onScore(match)}
        aria-label={`${scoreLabel}: ${teamLabel(match.team_a_name, match.team_a_placeholder)} vs ${teamLabel(match.team_b_name, match.team_b_placeholder)}`}
      >
        {body}
      </button>
    )
  }

  return <article className={className}>{body}</article>
}

export default function TournamentBracket({
  matches,
  myTeamId,
  stage: stageProp,
  onScoreMatch,
  scoreOwnMatchesOnly = false,
}: {
  matches: Match[]
  myTeamId?: string
  /** When omitted, inferred from the matches (fixes empty Plate brackets). */
  stage?: 'KNOCKOUT' | 'PLATE'
  /** Tap a match to open score entry (admin: any; player: own with scoreOwnMatchesOnly). */
  onScoreMatch?: (m: Match) => void
  /** When true, only matches involving myTeamId that can still be scored are tappable. */
  scoreOwnMatchesOnly?: boolean
}) {
  const stage = stageProp || inferStage(matches)
  const rounds = useMemo(() => buildRounds(matches, stage), [matches, stage])
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [activeRound, setActiveRound] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)

  const roundKey = `${stage}|${rounds.map((r) => r.round).join('|')}`
  const isPlate = stage === 'PLATE'
  const title = isPlate ? 'Plate' : 'Championship'
  const lead = isPlate ? 'Consolation path to the plate final.' : 'Path to the final.'
  const tabsLabel = isPlate ? 'Plate rounds' : 'Championship rounds'
  const championLabel = isPlate ? 'Plate champion' : 'Champion'

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!rounds.length) return
    setActiveRound(currentRoundIndex(rounds))
    // Only re-focus when the bracket structure changes, not on every score refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundKey])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    // Keep the selected round tab visible in the horizontal tab strip
    const tab = root.querySelector<HTMLElement>('.tb-tab[aria-selected="true"]')
    tab?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    })

    const el = scrollerRef.current
    if (!el || !rounds.length) return
    // Desktop-only scroll target; mobile uses the focused list
    if (window.matchMedia('(max-width: 899px)').matches) return
    const col = el.querySelector<HTMLElement>(`[data-round-index="${activeRound}"]`)
    if (!col) return
    const track = el.firstElementChild as HTMLElement | null
    const left = col.offsetLeft - (track?.offsetLeft ?? 0)
    el.scrollTo({ left: Math.max(0, left - 8), behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [activeRound, rounds.length, reduceMotion])

  if (!rounds.length) return null

  const safeIndex = Math.min(Math.max(0, activeRound), rounds.length - 1)
  const active = rounds[safeIndex]
  const firstRoundCount = Math.max(1, rounds[0]?.matches.length || 1)
  const finalMatch = rounds.find((r) => r.round === 'FINAL')?.matches[0]
  const finalDone =
    !!finalMatch && (finalMatch.status === 'COMPLETED' || finalMatch.status === 'WALKOVER')
  const championName = finalDone
    ? finalMatch.winner_id === finalMatch.team_a_id
      ? finalMatch.team_a_name
      : finalMatch.winner_id === finalMatch.team_b_id
        ? finalMatch.team_b_name
        : null
    : null

  return (
    <div
      className={`tb${isPlate ? ' is-plate' : ''}`}
      ref={rootRef}
      style={{ ['--tb-first-count' as string]: String(firstRoundCount) }}
    >
      <div className="tb-head">
        <div>
          <h2 className="tb-title">{title}</h2>
          <p className="tb-lead">{lead}</p>
        </div>
        {championName ? (
          <div className="tb-champion" aria-label={`${championLabel} ${championName}`}>
            <span className="tb-champion-label">{championLabel}</span>
            <strong>{championName}</strong>
          </div>
        ) : null}
      </div>

      {rounds.length > 1 ? (
        <div className="tb-tabs" role="tablist" aria-label={tabsLabel}>
          {rounds.map((r, i) => (
            <button
              key={r.round}
              type="button"
              role="tab"
              aria-selected={safeIndex === i}
              aria-label={r.label}
              className={`tb-tab ${safeIndex === i ? 'is-active' : ''}`}
              onClick={() => setActiveRound(i)}
            >
              <span className="tb-tab-full">{r.label}</span>
              <span className="tb-tab-short">{r.shortLabel}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Mobile: one round at a time */}
      <div className="tb-mobile">
        <div className="tb-mobile-head">
          <h3 className="tb-round-label">{active.label}</h3>
          <span className="tb-mobile-count">
            {active.matches.length} match{active.matches.length === 1 ? '' : 'es'}
          </span>
        </div>
        <div className="tb-mobile-list">
          {active.matches.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              myTeamId={myTeamId}
              onScore={onScoreMatch}
              scoreOwnMatchesOnly={scoreOwnMatchesOnly}
            />
          ))}
        </div>
      </div>

      {/* Desktop: full horizontal bracket */}
      <div className="tb-scroll" ref={scrollerRef}>
        <div className="tb-track">
          {rounds.map((r, ri) => (
            <section
              key={r.round}
              className={`tb-round ${safeIndex === ri ? 'is-active' : ''}`}
              data-round-index={ri}
              aria-label={r.label}
            >
              <h3 className="tb-round-label">{r.label}</h3>
              <div className="tb-round-matches">
                {r.matches.map((m) => (
                  <div key={m.id} className="tb-slot">
                    <MatchCard
                      match={m}
                      myTeamId={myTeamId}
                      onScore={onScoreMatch}
                      scoreOwnMatchesOnly={scoreOwnMatchesOnly}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
