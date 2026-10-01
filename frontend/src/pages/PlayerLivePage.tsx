import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { tournamentApi, type Match } from '../services/api'
import { formatMatchScore, formatTime, courtLabel } from '../utils/format'
import './PlayerLive.css'

export default function PlayerLivePage() {
  const { slug = '' } = useParams()
  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['player-view', slug],
    queryFn: async () => (await tournamentApi.playerView(slug)).data,
    enabled: !!slug,
    retry: 4,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 10000),
    refetchInterval: (query) => (query.state.status === 'error' ? 5000 : 8000),
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
          <p>Could not load the live board.</p>
          <p className="muted-note" style={{ marginTop: 8 }}>
            The server may be waking up. Wait a few seconds and try again.
          </p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying...' : 'Retry'}
            </button>
            <Link to="/tournaments" className="btn btn-ghost">
              Tournaments
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const t = data.tournament
  const next = data.next_match as Match | null
  const myTeam = data.my_team as { id: string; name: string; payment_status?: string } | null
  const myPayment = myTeam?.payment_status
  const hasPaidEntry = !!myTeam && myPayment === 'PAID'
  const hasPendingEntry = !!myTeam && myPayment === 'PENDING'
  const myTeamId = hasPaidEntry ? myTeam?.id : undefined
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
          {dataUpdatedAt > 0 && (
            <p className="pl-updated">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </header>

        {(data.live_matches || []).length > 0 && (
          <section className="pl-block">
            <h2>Live now</h2>
            <ul className="pl-live-list">
              {(data.live_matches as Match[]).map((m) => (
                <li key={m.id}>
                  <strong>{courtLabel(m.court_name, m.court_number)}</strong>
                  <span>
                    {m.team_a_name || m.team_a_placeholder || 'TBD'} vs {m.team_b_name || m.team_b_placeholder || 'TBD'}
                  </span>
                  <span>{formatMatchScore(m.score)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="pl-next">
          <h2>Your next match</h2>
          {hasPendingEntry ? (
            <div className="pl-next-card">
              <p className="pl-empty" style={{ marginBottom: 12 }}>
                Your registration is waiting for payment.
              </p>
              <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block">
                Complete payment
              </Link>
            </div>
          ) : next && hasPaidEntry ? (
            <div className="pl-next-card">
              <div className="pl-court">{courtLabel(next.court_name, next.court_number)}</div>
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
              {hasPaidEntry
                ? 'No upcoming matches scheduled yet.'
                : 'Register for this tournament to see your next match here.'}
            </p>
          )}
          {!hasPaidEntry && !hasPendingEntry && t.status === 'REGISTRATION_OPEN' && (
            <Link to={`/t/${slug}/join`} className="btn btn-primary btn-block" style={{ marginTop: 12 }}>
              Join tournament
            </Link>
          )}
        </section>

        <section className="pl-block">
          <h2>Your results</h2>
          {(!hasPaidEntry || (data.my_results || []).length === 0) && (
            <p className="pl-empty">{hasPaidEntry ? 'No results yet.' : 'Results appear after you register and play.'}</p>
          )}
          {hasPaidEntry && (
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
          )}
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
