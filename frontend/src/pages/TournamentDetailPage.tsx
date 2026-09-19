import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { tournamentApi } from '../services/api'
import {
  currentSetScores,
  formatDate,
  formatMoney,
  formatTime,
  isPastCalendarDate,
  spotsLeftLabel,
  statusBadgeClass,
  statusLabel,
} from '../utils/format'
import './Tournament.css'

export default function TournamentDetailPage() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const isOps = user?.role === 'ORGANISER' || user?.role === 'ADMIN'
  const { data: tournament, isLoading, isError } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: async () => (await tournamentApi.get(slug)).data,
    enabled: !!slug,
  })
  const { data: announcements = [] } = useQuery({
    queryKey: ['announcements', slug],
    queryFn: async () => (await tournamentApi.announcements(slug)).data,
    enabled: !!slug,
  })
  const { data: matches = [] } = useQuery({
    queryKey: ['matches', slug],
    queryFn: async () => (await tournamentApi.matches(slug)).data,
    enabled: !!slug,
    refetchInterval: 12000,
  })

  const { data: playerView } = useQuery({
    queryKey: ['player-view', slug],
    queryFn: async () => (await tournamentApi.playerView(slug)).data,
    enabled: !!slug,
  })

  if (isLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ width: '60%', height: 32, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: '40%', height: 18 }} />
        </main>
      </div>
    )
  }

  if (isError || !tournament) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Tournament not found</h1>
          <p className="page-sub">Check the link or browse upcoming events.</p>
          <Link to="/tournaments" className="btn btn-primary">
            Browse tournaments
          </Link>
        </main>
      </div>
    )
  }

  const live = matches.filter((m) => m.status === 'LIVE')
  const upcoming = matches.filter((m) => m.status === 'SCHEDULED' || m.status === 'CALLED').slice(0, 8)
  const qrUrl = `${window.location.origin}/t/${tournament.slug}`
  const spots = spotsLeftLabel(tournament.registered_teams, tournament.max_teams)

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page tourney-detail">
        <p className="eyebrow">{tournament.location}</p>
        <h1 className="page-title">{tournament.name}</h1>
        <p className="page-sub">
          {tournament.venue} · {formatDate(tournament.event_date, { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
          {formatTime(tournament.start_time)}
        </p>

        <div className="tour-actions">
          {tournament.status === 'REGISTRATION_OPEN' &&
            !playerView?.my_team &&
            tournament.registered_teams < tournament.max_teams &&
            !isPastCalendarDate(tournament.registration_deadline) && (
              <Link to={`/t/${tournament.slug}/join`} className="btn btn-primary">
                Join Tournament
              </Link>
            )}
          {tournament.status === 'REGISTRATION_OPEN' &&
            !playerView?.my_team &&
            (tournament.registered_teams >= tournament.max_teams ||
              isPastCalendarDate(tournament.registration_deadline)) && (
              <span className="btn btn-ghost" style={{ cursor: 'default', opacity: 0.85 }}>
                {isPastCalendarDate(tournament.registration_deadline)
                  ? 'Registration closed'
                  : 'Tournament full — watch this page for withdrawals'}
              </span>
            )}
          {playerView?.my_team && (
            <Link to={`/t/${tournament.slug}/live`} className="btn btn-primary">
              My matches · {playerView.my_team.name}
            </Link>
          )}
          {!playerView?.my_team && (
            <Link to={`/t/${tournament.slug}/live`} className="btn btn-dark">
              Live scores
            </Link>
          )}
          {isOps && (
            <Link to={`/tournament/${tournament.slug}/display`} className="btn btn-ghost">
              TV display
            </Link>
          )}
        </div>

        <div className="tour-stats">
          <div>
            <strong>{tournament.registered_teams}</strong>
            <span>Doubles teams</span>
          </div>
          <div>
            <strong>{tournament.number_of_courts}</strong>
            <span>Courts</span>
          </div>
          <div>
            <strong>{formatMoney(tournament.entry_fee_cents, tournament.currency)}</strong>
            <span>Per doubles team</span>
          </div>
          <div>
            <strong>{spots === 'Full' ? 'Full' : tournament.max_teams - tournament.registered_teams}</strong>
            <span>{spots === 'Full' ? 'No spots left' : 'Spots left'}</span>
          </div>
        </div>

        <div style={{ marginBottom: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className={`badge ${statusBadgeClass(tournament.status)}`}>{statusLabel(tournament.status)}</span>
          {tournament.registration_deadline && tournament.status === 'REGISTRATION_OPEN' && (
            <span className="tour-deadline">
              Register by {formatDate(tournament.registration_deadline, { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>

        {live.length > 0 && (
          <section className="block">
            <h2>
              <span className="live-dot" /> Live now
            </h2>
            <div className="live-grid">
              {live.map((m) => {
                const s = currentSetScores(m.score)
                return (
                  <div key={m.id} className="live-tile">
                    <div className="live-court">Court {m.court_number}</div>
                    <div className="live-score-row">
                      <span>{m.team_a_name || m.team_a_placeholder || 'TBD'}</span>
                      <strong>{s.a}</strong>
                    </div>
                    <div className="live-score-row">
                      <span>{m.team_b_name || m.team_b_placeholder || 'TBD'}</span>
                      <strong>{s.b}</strong>
                    </div>
                    <div className="live-set">Set {s.set}</div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="block">
            <h2>Coming up</h2>
            <ul className="match-preview-list">
              {upcoming.map((m) => (
                <li key={m.id}>
                  <span className="match-preview-court">
                    {m.status === 'CALLED' ? 'Called' : `Court ${m.court_number ?? 'TBC'}`}
                  </span>
                  <span>
                    {m.team_a_name || m.team_a_placeholder || 'TBD'} vs {m.team_b_name || m.team_b_placeholder || 'TBD'}
                  </span>
                  <span className="match-preview-time">{formatTime(m.scheduled_start)}</span>
                </li>
              ))}
            </ul>
            <Link to={`/t/${tournament.slug}/live`} className="tour-inline-link">
              Full live view
            </Link>
          </section>
        )}

        {announcements.length > 0 && (
          <section className="block">
            <h2>Announcements</h2>
            {announcements.map((a: { id: string; title: string; body: string }) => (
              <div key={a.id} className="announce">
                <strong>{a.title}</strong>
                <p>{a.body}</p>
              </div>
            ))}
          </section>
        )}

        {tournament.description && (
          <section className="block">
            <h2>About</h2>
            <p>{tournament.description}</p>
          </section>
        )}

        {tournament.rules && (
          <section className="block">
            <h2>Rules</h2>
            <p className="rules">{tournament.rules}</p>
          </section>
        )}

        <section className="block qr-block">
          <h2>Share this event</h2>
          <p>Send the link to your partner, or put the QR on a poster at the venue.</p>
          <div className="qr-wrap">
            <QRCodeSVG value={qrUrl} size={160} bgColor="#ffffff" fgColor="#0b3d2e" />
            <code>{qrUrl.replace(/^https?:\/\//, '')}</code>
          </div>
        </section>
      </main>
    </div>
  )
}
