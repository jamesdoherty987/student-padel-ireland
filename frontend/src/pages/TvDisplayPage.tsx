import type { CSSProperties } from 'react'
import { useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import SponsorStrip from '../components/SponsorStrip'
import { hapticLight } from '../native/haptics'
import { isNativeApp } from '../native/platform'
import { setStatusBarForDarkScreen, setStatusBarForLightScreen } from '../native/statusBar'
import { tournamentApi, type Match } from '../services/api'
import { currentSetScores, formatLiveBoardScore, formatTime } from '../utils/format'
import './TvDisplay.css'

function teamName(m: Match, side: 'a' | 'b') {
  if (side === 'a') return m.team_a_name || m.team_a_placeholder || 'TBD'
  return m.team_b_name || m.team_b_placeholder || 'TBD'
}

/** Even grid that stays on one TV screen (e.g. 4 courts → 2×2). */
function gridDims(count: number): { cols: number; rows: number } {
  const n = Math.max(1, count)
  if (n <= 1) return { cols: 1, rows: 1 }
  if (n === 2) return { cols: 2, rows: 1 }
  if (n === 3) return { cols: 3, rows: 1 }
  if (n === 4) return { cols: 2, rows: 2 }
  if (n <= 6) return { cols: 3, rows: 2 }
  if (n <= 8) return { cols: 4, rows: 2 }
  if (n <= 9) return { cols: 3, rows: 3 }
  if (n <= 12) return { cols: 4, rows: 3 }
  const cols = Math.ceil(Math.sqrt(n))
  return { cols, rows: Math.ceil(n / cols) }
}

function isOnCourt(status: string) {
  return status === 'LIVE' || status === 'CALLED' || status === 'AWAITING_CONFIRM'
}

function CourtPanel({ label, matches }: { label: string; matches: Match[] }) {
  const activePool = matches.filter(
    (m) =>
      m.status === 'LIVE' ||
      m.status === 'CALLED' ||
      m.status === 'SCHEDULED' ||
      m.status === 'AWAITING_CONFIRM',
  )
  const current =
    activePool.find((m) => m.status === 'LIVE') ||
    activePool.find((m) => m.status === 'CALLED') ||
    activePool.find((m) => m.status === 'AWAITING_CONFIRM') ||
    activePool.find((m) => m.status === 'SCHEDULED') ||
    null
  const nextUp =
    current &&
    activePool
      .filter((m) => m.id !== current.id && m.status === 'SCHEDULED')
      .sort((a, b) => {
        const ta = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
        const tb = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
        return ta - tb
      })[0]

  if (!current) {
    return (
      <article className="tv-court empty">
        <div className="tv-court-num">{label}</div>
        <p className="tv-empty-label">Open</p>
      </article>
    )
  }

  const status = current.status
  const board = formatLiveBoardScore(current.score)
  const games = currentSetScores(current.score)
  const onCourt = isOnCourt(status)
  const hasScore = !!(
    current.score &&
    (current.score.set1_a ||
      current.score.set1_b ||
      current.score.set2_a ||
      current.score.set2_b)
  )
  const pill =
    status === 'AWAITING_CONFIRM'
      ? { className: 'tv-pill tv-pill-called', label: 'Confirm' }
      : status === 'CALLED'
        ? { className: 'tv-pill tv-pill-called', label: 'Go now' }
        : status === 'LIVE'
          ? { className: 'tv-pill tv-pill-live', label: 'Live' }
          : { className: 'tv-pill tv-pill-next', label: 'Next' }

  return (
    <article
      className={`tv-court ${onCourt ? 'is-active' : ''} ${status === 'LIVE' ? 'is-live' : ''} ${status === 'CALLED' || status === 'AWAITING_CONFIRM' ? 'is-called' : ''} ${status === 'SCHEDULED' ? 'is-upcoming' : ''}`}
    >
      <div className="tv-court-num">
        <span>{label}</span>
        <span className={pill.className}>{pill.label}</span>
      </div>

      <div className="tv-match">
        {onCourt ? (
          <>
            <div className="tv-row">
              <span title={teamName(current, 'a')}>{teamName(current, 'a')}</span>
              <strong>{hasScore ? games.a : '·'}</strong>
            </div>
            <div className="tv-row">
              <span title={teamName(current, 'b')}>{teamName(current, 'b')}</span>
              <strong>{hasScore ? games.b : '·'}</strong>
            </div>
            {hasScore && board.sets && board.sets.includes(' ') ? (
              <div className="tv-meta">
                <span>{board.sets}</span>
              </div>
            ) : null}
            {status === 'CALLED' && !hasScore ? <p className="tv-hint">Players to court</p> : null}
            {status === 'AWAITING_CONFIRM' ? <p className="tv-hint">Confirming score</p> : null}
          </>
        ) : (
          <>
            <div className="tv-upcoming-names">
              <div title={teamName(current, 'a')}>{teamName(current, 'a')}</div>
              <span>vs</span>
              <div title={teamName(current, 'b')}>{teamName(current, 'b')}</div>
            </div>
            <p className="tv-hint">{formatTime(current.scheduled_start)}</p>
          </>
        )}
      </div>

      {nextUp ? (
        <div className="tv-court-next">
          <span className="tv-court-next-label">Then</span>
          <span title={`${teamName(nextUp, 'a')} vs ${teamName(nextUp, 'b')}`}>
            {teamName(nextUp, 'a')} vs {teamName(nextUp, 'b')}
          </span>
        </div>
      ) : null}
    </article>
  )
}

function UnassignedPanel({ matches }: { matches: Match[] }) {
  if (matches.length === 0) return null
  return (
    <section className="tv-unassigned" aria-label="Matches without a court">
      <h2>Needs court</h2>
      <ul>
        {matches.map((m) => (
          <li key={m.id}>
            <span className={`tv-pill ${isOnCourt(m.status) ? 'tv-pill-called' : 'tv-pill-next'}`}>
              {m.status === 'LIVE' ? 'Live' : m.status === 'CALLED' ? 'Go now' : m.status.replace(/_/g, ' ')}
            </span>
            <span title={`${teamName(m, 'a')} vs ${teamName(m, 'b')}`}>
              {teamName(m, 'a')} vs {teamName(m, 'b')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function TvDisplayPage() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const displayCode = (searchParams.get('code') || '').trim()
  const navigate = useNavigate()
  const native = isNativeApp()

  useEffect(() => {
    void setStatusBarForDarkScreen()
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevHtmlOverscroll = html.style.overscrollBehavior
    const prevBodyOverscroll = body.style.overscrollBehavior
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    body.style.overscrollBehavior = 'none'
    html.classList.add('tv-display-active')
    return () => {
      void setStatusBarForLightScreen()
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      html.style.overscrollBehavior = prevHtmlOverscroll
      body.style.overscrollBehavior = prevBodyOverscroll
      html.classList.remove('tv-display-active')
    }
  }, [])

  const closeDisplay = () => {
    void hapticLight()
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1)
      return
    }
    navigate(id ? `/manage?t=${id}` : '/manage')
  }

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['display', id, displayCode],
    queryFn: async () =>
      (await tournamentApi.display(id, { code: displayCode || undefined })).data,
    enabled: !!id,
    refetchInterval: (query) => (query.state.status === 'error' ? 2500 : 2500),
    retry: 4,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
  })
  const { data: sponsors = [] } = useQuery({
    queryKey: ['sponsors', id, displayCode],
    queryFn: async () =>
      (await tournamentApi.sponsors(id, { code: displayCode || undefined })).data,
    enabled: !!id,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="tv-root loading">
        {native ? (
          <button type="button" className="tv-close" onClick={closeDisplay} aria-label="Close display">
            <i className="fas fa-xmark" aria-hidden />
          </button>
        ) : null}
        Loading display…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="tv-root loading">
        {native ? (
          <button type="button" className="tv-close" onClick={closeDisplay} aria-label="Close display">
            <i className="fas fa-xmark" aria-hidden />
          </button>
        ) : null}
        <div className="tv-error">
          <p>Could not load the display.</p>
          <button type="button" className="btn btn-primary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    )
  }

  const courts = (data.courts || {}) as Record<string, Match[]>
  const courtNames = (data.court_names || {}) as Record<string, string>
  const unassigned = (data.unassigned || []) as Match[]
  const total = data.tournament.number_of_courts || Object.keys(courts).length || 1
  const slots = Array.from({ length: Math.max(1, total) }, (_, i) => i + 1)
  const onCourtCount =
    slots.reduce(
      (n, c) => n + (courts[String(c)] || []).filter((m) => isOnCourt(m.status)).length,
      0,
    ) + unassigned.filter((m) => isOnCourt(m.status)).length

  const { cols, rows } = gridDims(slots.length)

  return (
    <div className="tv-root">
      {native ? (
        <button type="button" className="tv-close" onClick={closeDisplay} aria-label="Close display">
          <i className="fas fa-xmark" aria-hidden />
        </button>
      ) : null}
      <header className="tv-header">
        <div className="tv-header-main">
          <BrandLogo to={null} className="tv-brand" size="sm" />
          <div className="tv-title-row">
            <h1>{data.tournament.name}</h1>
            {onCourtCount > 0 ? (
              <span className="tv-pill tv-pill-called">
                {onCourtCount} on court
              </span>
            ) : null}
          </div>
        </div>
        {sponsors.length > 0 ? (
          <div className="tv-sponsors">
            <SponsorStrip sponsors={sponsors} placement="hero" compact tone="dark" />
          </div>
        ) : null}
      </header>

      <div
        className="tv-grid"
        style={{ '--cols': cols, '--rows': rows } as CSSProperties}
      >
        {slots.map((n) => (
          <CourtPanel
            key={n}
            label={courtNames[String(n)] || `Court ${n}`}
            matches={courts[String(n)] || []}
          />
        ))}
      </div>

      <UnassignedPanel matches={unassigned} />
    </div>
  )
}
