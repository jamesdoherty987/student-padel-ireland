import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { tournamentApi } from '../services/api'
import { formatDate, formatMoney, statusBadgeClass, statusLabel } from '../utils/format'
import './Tournament.css'

export default function TournamentsPage() {
  const { data: tournaments = [], isLoading, isError } = useQuery({
    queryKey: ['tournaments'],
    queryFn: async () => (await tournamentApi.list()).data,
  })

  return (
    <div>
      <NavBar />
      <main className="page">
        <h1 className="page-title">Tournaments</h1>
        <p className="page-sub">Find an event and join with your partner.</p>
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 88 }} />
            ))}
          </div>
        )}
        {isError && (
          <div className="empty-state">
            <p>Could not load tournaments. Is the API running?</p>
          </div>
        )}
        <div className="tour-list">
          {tournaments.map((t) => (
            <Link key={t.id} to={`/t/${t.slug}`} className="tour-card-link">
              <article className="tour-card">
                <div className="tour-card-top">
                  <h2>{t.name}</h2>
                  <span className={`badge ${statusBadgeClass(t.status)}`}>{statusLabel(t.status)}</span>
                </div>
                <p>
                  {t.location} · {t.venue}
                </p>
                <p className="tour-card-meta">
                  {formatDate(t.event_date, { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                  {t.registered_teams}/{t.max_teams} teams · {formatMoney(t.entry_fee_cents, t.currency)}
                </p>
              </article>
            </Link>
          ))}
        </div>
        {!isLoading && !isError && tournaments.length === 0 && (
          <div className="empty-state">
            <p>No tournaments yet.</p>
            <Link to="/signup?role=ORGANISER" className="btn btn-primary" style={{ marginTop: 12 }}>
              Create a tournament
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}
