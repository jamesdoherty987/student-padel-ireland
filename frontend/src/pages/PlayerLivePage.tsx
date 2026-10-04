import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import NavBar from '../components/NavBar'
import { tournamentApi, type Match } from '../services/api'
import { formatLiveBoardScore, formatMatchScore, formatTime, courtLabel } from '../utils/format'
import './PlayerLive.css'

type LiveAnnouncement = {
  id: string
  title: string
  body: string
  is_pinned?: boolean
}

function MatchNames({ m }: { m: Match }) {
  return (
    <>
      {m.team_a_name || m.team_a_placeholder || 'TBD'} vs {m.team_b_name || m.team_b_placeholder || 'TBD'}
    </>
  )
}

function NextMatchCard({ next, slug }: { next: Match; slug: string }) {
  const board = next.status === 'LIVE' ? formatLiveBoardScore(next.score) : null
  return (
    <div
      className={`pl-next-card ${next.status === 'CALLED' ? 'is-called' : ''} ${next.status === 'LIVE' ? 'is-live' : ''}`}
    >
      {next.status === 'CALLED' && <p className="pl-go-now">Go to court now</p>}
      {next.status === 'LIVE' && <p className="pl-go-now">Your match is live</p>}
      <div className="pl-court">{courtLabel(next.court_name, next.court_number)}</div>
      <div className="pl-time">
        {next.status === 'CALLED'
          ? 'Called to court'
          : next.status === 'LIVE'
            ? 'Playing now'
            : formatTime(next.scheduled_start)}
      </div>
      <div className="pl-vs">
        <div>{next.team_a_name || next.team_a_placeholder || 'TBD'}</div>
        <span>VS</span>
        <div>{next.team_b_name || next.team_b_placeholder || 'TBD'}</div>
      </div>
      {board && (
        <p className="pl-next-score">
          Set {board.set} · {board.games}
          {board.sets ? ` · Sets ${board.sets}` : ''}
        </p>
      )}
      <Link to={`/t/${slug}`} className="pl-details-link">
        Full tournament page
      </Link>
    </div>
  )
}

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
  const liveMatches = (data.live_matches || []) as Match[]
  const calledMatches = (data.called_matches || []) as Match[]
  const standings = (data.standings || []) as Array<{
    group: string
    standings: Array<{ team_id: string; team_name: string; points: number }>
  }>
  const announcements = (data.announcements || []) as LiveAnnouncement[]
  const myUpcoming = (data.my_upcoming || []) as Match[]
  const myResults = (data.my_results || []) as Match[]

  return (
    <div className="app-shell">
      <NavBar />
      <main className="pl-page">
        <header className="pl-header">
          <BrandLogo to="/tournaments" className="pl-brand" size="sm" />
          <div className="pl-title-row">
            <h1>{t.name}</h1>
            {liveMatches.length > 0 && (
              <span className="badge badge-live">
                <span className="live-dot" /> LIVE
              </span>
            )}
          </div>
          <p className="pl-lead">Courts, calls, and scores — updates every few seconds.</p>
          {dataUpdatedAt > 0 && (
            <p className="pl-updated">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
              {isFetching ? ' · refreshing…' : ''}
            </p>
          )}
        </header>

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
            <NextMatchCard next={next} slug={slug} />
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
          {(!next || !hasPaidEntry) && (
            <Link to={`/t/${slug}`} className="pl-details-link pl-details-link--muted">
              Full tournament page
            </Link>
          )}
        </section>

        {hasPaidEntry && myUpcoming.length > 1 && (
          <section className="pl-block">
            <h2>Your schedule</h2>
            <ul className="pl-schedule">
              {myUpcoming.map((m, i) => (
                <li key={m.id} className={i === 0 ? 'is-next' : ''}>
                  <strong>{courtLabel(m.court_name, m.court_number)}</strong>
                  <span>
                    {m.status === 'CALLED'
                      ? 'Called now'
                      : m.status === 'LIVE'
                        ? 'Live'
                        : formatTime(m.scheduled_start)}
                  </span>
                  <span>
                    <MatchNames m={m} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="pl-block">
          <h2>Your results</h2>
          {(!hasPaidEntry || myResults.length === 0) && (
            <p className="pl-empty">{hasPaidEntry ? 'No results yet.' : 'Results appear after you register and play.'}</p>
          )}
          {hasPaidEntry && myResults.length > 0 && (
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
