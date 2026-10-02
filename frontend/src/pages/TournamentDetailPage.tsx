import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { ShareQr } from '../components/ShareQr'
import { useAuth } from '../context/AuthContext'
import { tournamentApi } from '../services/api'
import { publicPathUrl } from '../native/platform'
import {
  courtLabel,
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
  const { data: tournament, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['tournament', slug, user?.id],
    queryFn: async () => (await tournamentApi.get(slug)).data,
    enabled: !!slug,
    retry: 4,
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

  const isOps = !!user && !!tournament?.can_manage

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
          <h1 className="page-title">Could not load this tournament</h1>
          <p className="page-sub">The server may be waking up. Try again in a few seconds.</p>
          <div className="header-actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying...' : 'Retry'}
            </button>
            <Link to="/tournaments" className="btn btn-ghost">
              Browse tournaments
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const live = matches.filter((m) => m.status === 'LIVE')
  const upcoming = matches.filter((m) => m.status === 'SCHEDULED' || m.status === 'CALLED').slice(0, 8)
  const liveUrl = publicPathUrl(`/t/${tournament.slug}/live`)
  const joinUrl = tournament.invite_code
    ? publicPathUrl(`/join/${tournament.invite_code}`)
    : publicPathUrl(`/t/${tournament.slug}/join`)
  const myPayment = (playerView?.my_team as { payment_status?: string } | null)?.payment_status
  const hasPaidEntry = !!playerView?.my_team && myPayment === 'PAID'
  const hasPendingEntry = !!playerView?.my_team && myPayment === 'PENDING'

  const singles = tournament.play_format === 'SINGLES'
  const spots = spotsLeftLabel(tournament.registered_teams, tournament.max_teams, tournament.play_format)
  const canJoin =
    tournament.status === 'REGISTRATION_OPEN' &&
    tournament.registered_teams < tournament.max_teams &&
    !isPastCalendarDate(tournament.registration_deadline) &&
    !hasPaidEntry
  const showInvite = !!tournament.invite_code && (canJoin || isOps)

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
          {canJoin && (
              <Link to={`/t/${tournament.slug}/join`} className="btn btn-primary">
                {hasPendingEntry ? 'Complete payment' : 'Join tournament'}
              </Link>
            )}
          {tournament.status === 'REGISTRATION_OPEN' &&
            !hasPaidEntry &&
            (tournament.registered_teams >= tournament.max_teams ||
              isPastCalendarDate(tournament.registration_deadline)) && (
              <p className="muted-note tour-closed-note">
                {isPastCalendarDate(tournament.registration_deadline)
                  ? 'Registration closed'
                  : `Tournament is full. Check back if a ${singles ? 'player' : 'team'} withdraws.`}
              </p>
            )}
          {hasPaidEntry && (
            <Link to={`/t/${tournament.slug}/live`} className="btn btn-primary">
              My matches · {playerView?.my_team?.name}
            </Link>
          )}
          {!hasPaidEntry && (
            <Link to={`/t/${tournament.slug}/live`} className="btn btn-ghost">
              Live scores
            </Link>
          )}
          {isOps && (
            <>
              <Link to={`/organiser?t=${tournament.id}`} className="btn btn-dark">
                Manage event
              </Link>
              <Link to={`/tournament/${tournament.slug}/display`} className="btn btn-ghost">
                TV display
              </Link>
            </>
          )}
        </div>

        <div className="tour-stats">
          {isOps && (
            <div>
              <strong>{tournament.registered_teams}</strong>
              <span>{singles ? 'Players' : 'Doubles teams'}</span>
            </div>
          )}
          <div>
            <strong>{tournament.number_of_courts}</strong>
            <span>Courts</span>
          </div>
          <div>
            <strong>{formatMoney(tournament.entry_fee_cents, tournament.currency)}</strong>
            <span>Per player</span>
          </div>
          {isOps && (
            <div>
              <strong>{spots === 'Full' ? 'Full' : tournament.max_teams - tournament.registered_teams}</strong>
              <span>{spots === 'Full' ? 'No spots left' : 'Spots left'}</span>
            </div>
          )}
        </div>

        <div className="tour-status-row">
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
                    <div className="live-court">{courtLabel(m.court_name, m.court_number)}</div>
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
                    {m.status === 'CALLED'
                      ? `Called · ${courtLabel(m.court_name, m.court_number)}`
                      : courtLabel(m.court_name, m.court_number)}
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

        {showInvite && (
          <section className="block qr-block">
            <h2>Invite players</h2>
            <p>
              Share the code or QR. Friends tap <strong>Have a code?</strong> on Tournaments.
            </p>
            {tournament.invite_code && (
              <p className="invite-code-line">
                Code <code className="share-code">{tournament.invite_code}</code>
              </p>
            )}
            <ShareQr url={joinUrl} openLabel="Open join page" />
          </section>
        )}

        <section className="block qr-block">
          <h2>Share live scores</h2>
          <p>Scan this QR on your phone to open the live board. No login needed.</p>
          <ShareQr url={liveUrl} openLabel="Open live board" />
        </section>
      </main>
    </div>
  )
}
