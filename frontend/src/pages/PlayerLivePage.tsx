import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { tournamentApi, type Match } from '../services/api'
import { formatMatchScore, formatTime } from '../utils/format'
import './PlayerLive.css'

export default function PlayerLivePage() {
  const { slug = '' } = useParams()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['player-view', slug],
    queryFn: async () => (await tournamentApi.playerView(slug)).data,
    enabled: !!slug,
    refetchInterval: 8000,
  })

  if (isLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="pl-page">
          <div className="skeleton" style={{ height: 28, width: '70%', marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 200, marginBottom: 16 }} />
        </main>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="pl-page empty-state">
          <p>Could not load this tournament.</p>
          <Link to="/tournaments" className="btn btn-ghost" style={{ marginTop: 12 }}>
            Back
          </Link>
        </main>
      </div>
    )
  }

  const t = data.tournament
  const next = data.next_match as Match | null
  const myTeamId = data.my_team?.id as string | undefined
  const standings = (data.standings || []) as Array<{
    group: string
    standings: Array<{ team_id: string; team_name: string; points: number }>
  }>

  return (
    <div className="app-shell">
      <NavBar />
      <main className="pl-page">
        <header className="pl-header">
          <p className="pl-brand">Student Padel Ireland</p>
          <h1>{t.name}</h1>
          {data.live_matches?.length > 0 && (
            <span className="badge badge-live">
              <span className="live-dot" /> LIVE
            </span>
          )}
        </header>

        <section className="pl-next">
          <h2>Your next match</h2>
          {next ? (
            <div className="pl-next-card">
              <div className="pl-court">Court {next.court_number ?? '—'}</div>
              <div className="pl-time">{formatTime(next.scheduled_start)}</div>
              <div className="pl-vs">
                <div>{next.team_a_name || next.team_a_placeholder || 'TBD'}</div>
                <span>VS</span>
                <div>{next.team_b_name || next.team_b_placeholder || 'TBD'}</div>
              </div>
              <Link to={`/t/${slug}`} className="btn btn-primary btn-block">
                View tournament
              </Link>
            </div>
          ) : (
            <p className="pl-empty">
              {data.my_team
                ? 'No upcoming matches scheduled yet.'
                : 'Register for this tournament to see your next match here.'}
            </p>
          )}
          {!data.my_team && t.status === 'REGISTRATION_OPEN' && (
            <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block" style={{ marginTop: 12 }}>
              Join Tournament
            </Link>
          )}
        </section>

        <section className="pl-block">
          <h2>Your results</h2>
          {(data.my_results || []).length === 0 && <p className="pl-empty">No results yet.</p>}
          <ul className="pl-results">
            {(data.my_results || []).map((m: Match) => {
              const won = m.winner_id ? m.winner_id === myTeamId : null
              const mark = won === true ? '✓' : won === false ? '✗' : '·'
              return (
                <li key={m.id} className={won === true ? 'win' : won === false ? 'loss' : ''}>
                  <span>
                    {mark} {formatMatchScore(m.score)}
                  </span>
                  <span>
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
    </div>
  )
}
