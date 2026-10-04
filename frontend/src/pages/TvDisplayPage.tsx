import type { CSSProperties } from 'react'
import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import { setStatusBarForDarkScreen, setStatusBarForLightScreen } from '../native/statusBar'
import { tournamentApi, type Match } from '../services/api'
import { currentSetScores, formatLiveBoardScore, formatTime } from '../utils/format'
import './TvDisplay.css'

function teamName(m: Match, side: 'a' | 'b') {
  if (side === 'a') return m.team_a_name || m.team_a_placeholder || 'TBD'
  return m.team_b_name || m.team_b_placeholder || 'TBD'
}

function CourtPanel({ label, matches }: { label: string; matches: Match[] }) {
  const current =
    matches.find((m) => m.status === 'LIVE') ||
    matches.find((m) => m.status === 'CALLED') ||
    matches.find((m) => m.status === 'SCHEDULED') ||
    null

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
  const isLive = status === 'LIVE'
  const isCalled = status === 'CALLED'

  return (
    <article
      className={`tv-court ${isLive ? 'is-live' : ''} ${isCalled ? 'is-called' : ''} ${status === 'SCHEDULED' ? 'is-upcoming' : ''}`}
    >
      <div className="tv-court-num">
        <span>{label}</span>
        {isLive && <span className="tv-pill tv-pill-live">LIVE</span>}
        {isCalled && <span className="tv-pill tv-pill-called">CALLED</span>}
        {status === 'SCHEDULED' && <span className="tv-pill tv-pill-next">UP NEXT</span>}
      </div>

      {(isLive || isCalled) && (
        <>
          <div className="tv-row">
            <span title={teamName(current, 'a')}>{teamName(current, 'a')}</span>
            <strong>{isLive ? games.a : '—'}</strong>
          </div>
          <div className="tv-row">
            <span title={teamName(current, 'b')}>{teamName(current, 'b')}</span>
            <strong>{isLive ? games.b : '—'}</strong>
          </div>
          {isLive && (
            <div className="tv-meta">
              <span>Set {board.set}</span>
              {board.sets && <span>Sets {board.sets}</span>}
            </div>
          )}
          {isCalled && <p className="tv-hint">Players to court</p>}
        </>
      )}

      {status === 'SCHEDULED' && (
        <>
          <div className="tv-upcoming-names">
            <div>{teamName(current, 'a')}</div>
            <span>vs</span>
            <div>{teamName(current, 'b')}</div>
          </div>
          <p className="tv-hint">{formatTime(current.scheduled_start)}</p>
        </>
      )}
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
            <span className={`tv-pill ${m.status === 'LIVE' ? 'tv-pill-live' : 'tv-pill-called'}`}>
              {m.status === 'LIVE' ? 'LIVE' : 'CALLED'}
            </span>
            <span>
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

  useEffect(() => {
    void setStatusBarForDarkScreen()
    return () => {
      void setStatusBarForLightScreen()
    }
  }, [])

  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['display', id],
    queryFn: async () => (await tournamentApi.display(id)).data,
    enabled: !!id,
    refetchInterval: (query) => (query.state.status === 'error' ? 4000 : 5000),
    retry: 4,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
  })

  if (isLoading) {
    return <div className="tv-root loading">Loading display…</div>
  }

  if (isError || !data) {
    return (
      <div className="tv-root loading">
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
  const liveCount =
    typeof data.live_count === 'number'
      ? data.live_count
      : slots.reduce((n, c) => n + (courts[String(c)] || []).filter((m) => m.status === 'LIVE').length, 0) +
        unassigned.filter((m) => m.status === 'LIVE').length

  const cols = slots.length <= 1 ? 1 : slots.length === 2 ? 2 : Math.min(slots.length, 3)

  return (
    <div className="tv-root">
      <header className="tv-header">
        <BrandLogo to={null} className="tv-brand" size="md" />
        <div className="tv-title-row">
          <h1>{data.tournament.name}</h1>
          {liveCount > 0 && (
            <span className="tv-pill tv-pill-live">
              {liveCount} LIVE
            </span>
          )}
        </div>
        {dataUpdatedAt > 0 && (
          <p className="tv-updated">
            Updated {new Date(dataUpdatedAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            {isFetching ? ' · refreshing…' : ''}
          </p>
        )}
      </header>

      <div className="tv-grid" style={{ '--cols': cols } as CSSProperties}>
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
