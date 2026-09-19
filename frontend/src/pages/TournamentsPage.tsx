import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { tournamentApi } from '../services/api'
import { formatDate, formatDoublesEntry, spotsLeftLabel, statusBadgeClass, statusLabel } from '../utils/format'
import './Tournament.css'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open to join' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
] as const

export default function TournamentsPage() {
  const { user } = useAuth()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [query, setQuery] = useState('')
  const { data: tournaments = [], isLoading, isError } = useQuery({
    queryKey: ['tournaments'],
    queryFn: async () => (await tournamentApi.list()).data,
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tournaments.filter((t) => {
      if (filter === 'open' && t.status !== 'REGISTRATION_OPEN') return false
      if (filter === 'live' && t.status !== 'LIVE') return false
      if (filter === 'upcoming' && (t.status === 'COMPLETED' || t.status === 'CANCELLED')) return false
      if (!q) return true
      return `${t.name} ${t.location} ${t.venue}`.toLowerCase().includes(q)
    })
  }, [tournaments, filter, query])

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <div className="page-header-row">
          <h1 className="page-title">Tournaments</h1>
          {(user?.role === 'ORGANISER' || user?.role === 'ADMIN') && (
            <Link to="/organiser" className="btn btn-ghost" style={{ minHeight: 40, padding: '0.4rem 0.9rem' }}>
              Dashboard
            </Link>
          )}
        </div>
        <p className="page-sub">Find an event near you and join with your partner.</p>

        <div className="tour-toolbar">
          <div className="filter-chips" role="tablist" aria-label="Filter tournaments">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`filter-chip ${filter === f.id ? 'on' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            className="form-input tour-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city, venue, or name"
            aria-label="Search tournaments"
          />
        </div>

        {isLoading && (
          <div className="tour-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 88, borderRadius: 12 }} />
            ))}
          </div>
        )}
        {isError && (
          <div className="empty-state">
            <p>Could not load tournaments. Is the API running?</p>
          </div>
        )}
        {!isLoading && !isError && (
          <div className="tour-list">
            {filtered.map((t) => {
              const spots = spotsLeftLabel(t.registered_teams, t.max_teams)
              return (
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
                      {formatDoublesEntry(t.registered_teams, t.max_teams, t.entry_fee_cents, t.currency)}
                      {t.status === 'REGISTRATION_OPEN' && t.registered_teams > 0 ? ` · ${spots}` : ''}
                    </p>
                  </article>
                </Link>
              )
            })}
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="empty-state">
            <p>{tournaments.length === 0 ? 'No tournaments yet. Check back soon.' : 'No events match that search.'}</p>
            {tournaments.length > 0 && (
              <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { setFilter('all'); setQuery('') }}>
                Clear filters
              </button>
            )}
            {tournaments.length === 0 && (user?.role === 'ORGANISER' || user?.role === 'ADMIN') && (
              <Link to="/organiser" className="btn btn-primary" style={{ marginTop: 12 }}>
                Create a tournament
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
