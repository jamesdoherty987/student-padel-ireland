import type { CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { tournamentApi, type Match } from '../services/api'
import { currentSetScores } from '../utils/format'
import './TvDisplay.css'

function CourtPanel({ court, matches }: { court: number; matches: Match[] }) {
  const current =
    matches.find((m) => m.status === 'LIVE') ||
    matches.find((m) => m.status === 'CALLED') ||
    matches[0]
  if (!current) {
    return (
      <div className="tv-court empty">
        <div className="tv-court-num">Court {court}</div>
        <p>Open</p>
      </div>
    )
  }
  const s = currentSetScores(current.score)

  return (
    <div className={`tv-court ${current.status === 'LIVE' ? 'is-live' : ''}`}>
      <div className="tv-court-num">
        Court {court}
        {current.status === 'LIVE' && <span className="tv-live">LIVE</span>}
      </div>
      <div className="tv-row">
        <span>{current.team_a_name || current.team_a_placeholder || 'TBD'}</span>
        <strong>{s.a}</strong>
      </div>
      <div className="tv-row">
        <span>{current.team_b_name || current.team_b_placeholder || 'TBD'}</span>
        <strong>{s.b}</strong>
      </div>
    </div>
  )
}

export default function TvDisplayPage() {
  const { id = '' } = useParams()
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['display', id],
    queryFn: async () => (await tournamentApi.display(id)).data,
    enabled: !!id,
    refetchInterval: 5000,
  })

  if (isLoading) {
    return <div className="tv-root loading">Loading display…</div>
  }

  if (isError || !data) {
    return (
      <div className="tv-root loading">
        <div style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: 16 }}>Could not load the display.</p>
          <button className="btn btn-primary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </div>
    )
  }

  const courts = data.courts as Record<string, Match[]>
  const total = data.tournament.number_of_courts || Object.keys(courts).length || 6
  const slots = Array.from({ length: total }, (_, i) => i + 1)

  return (
    <div className="tv-root">
      <header className="tv-header">
        <p>Student Padel Ireland</p>
        <h1>{data.tournament.name}</h1>
      </header>
      <div className="tv-grid" style={{ '--cols': Math.min(slots.length, 3) } as CSSProperties}>
        {slots.map((n) => (
          <CourtPanel key={n} court={n} matches={courts[String(n)] || []} />
        ))}
      </div>
    </div>
  )
}
