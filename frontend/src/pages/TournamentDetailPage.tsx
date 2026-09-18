import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import NavBar from '../components/NavBar'
import { tournamentApi } from '../services/api'
import { currentSetScores, formatDate, formatMoney, formatTime, statusBadgeClass, statusLabel } from '../utils/format'
import './Tournament.css'

export default function TournamentDetailPage() {
  const { slug = '' } = useParams()
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
      <div>
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
      <div>
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
  const qrUrl = `${window.location.origin}/t/${tournament.slug}`

  return (
    <div>
      <NavBar />
      <main className="page tourney-detail">
        <p className="eyebrow">{tournament.location}</p>
        <h1 className="page-title">{tournament.name}</h1>
        <p className="page-sub">
          {tournament.venue} · {formatDate(tournament.event_date, { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
          {formatTime(tournament.start_time)}
        </p>

        <div className="tour-actions">
          {tournament.status === 'REGISTRATION_OPEN' && !playerView?.my_team && (
            <Link to={`/t/${tournament.slug}/join`} className="btn btn-primary">
              Join Tournament
            </Link>
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
          <Link to={`/tournament/${tournament.slug}/display`} className="btn btn-ghost">
            TV Display
          </Link>
        </div>

        <div className="tour-stats">
          <div>
            <strong>{tournament.registered_teams}</strong>
            <span>Teams</span>
          </div>
          <div>
            <strong>{tournament.number_of_courts}</strong>
            <span>Courts</span>
          </div>
          <div>
            <strong>{formatMoney(tournament.entry_fee_cents, tournament.currency)}</strong>
            <span>Entry</span>
          </div>
          <div>
            <strong>{tournament.max_teams}</strong>
            <span>Max teams</span>
          </div>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <span className={`badge ${statusBadgeClass(tournament.status)}`}>{statusLabel(tournament.status)}</span>
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
          <h2>QR code</h2>
          <p>Put this on posters, court signs, and the tournament desk.</p>
          <div className="qr-wrap">
            <QRCodeSVG value={qrUrl} size={160} bgColor="#ffffff" fgColor="#0b3d2e" />
            <code>{qrUrl.replace(/^https?:\/\//, '')}</code>
          </div>
        </section>
      </main>
    </div>
  )
}
