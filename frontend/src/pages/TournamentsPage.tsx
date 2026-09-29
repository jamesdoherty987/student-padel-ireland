import { useMemo, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { HaveCodeButton } from '../components/JoinCodeModal'
import { useAuth } from '../context/AuthContext'
import { tournamentApi } from '../services/api'
import { looksLikeInviteCode, cleanInviteCode } from '../utils/inviteCode'
import { formatDate, formatDoublesEntry, spotsLeftLabel, statusBadgeClass, statusLabel } from '../utils/format'
import './Tournament.css'
import './Community.css'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open to join' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
] as const

export default function TournamentsPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [query, setQuery] = useState('')
  const openJoin = searchParams.get('join') === '1'
  const codeFromSearch = looksLikeInviteCode(query) ? cleanInviteCode(query) : ''

  const clearJoinParam = useCallback(() => {
    if (!openJoin) return
    const next = new URLSearchParams(searchParams)
    next.delete('join')
    setSearchParams(next, { replace: true })
  }, [openJoin, searchParams, setSearchParams])

  const { data: tournaments = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['tournaments'],
    queryFn: async () => (await tournamentApi.list()).data,
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Don't treat invite codes as name search
    if (looksLikeInviteCode(query)) return []
    return tournaments.filter((t) => {
      if (filter === 'open' && t.status !== 'REGISTRATION_OPEN') return false
      if (filter === 'live' && t.status !== 'LIVE') return false
      if (filter === 'upcoming' && t.status !== 'REGISTRATION_OPEN' && t.status !== 'REGISTRATION_CLOSED') {
        return false
      }
      if (filter === 'past' && t.status !== 'COMPLETED' && t.status !== 'CANCELLED') return false
      if (!q) return true
      return `${t.name} ${t.location} ${t.venue}`.toLowerCase().includes(q)
    })
  }, [tournaments, filter, query])

  const emptyMessage = (() => {
    if (tournaments.length === 0) return 'No tournaments yet. Check back soon.'
    if (codeFromSearch) return 'That looks like an invite code, not a search.'
    if (query.trim()) return 'No events match that search.'
    if (filter === 'open') return 'No tournaments open to join right now.'
    if (filter === 'live') return 'No live tournaments right now.'
    if (filter === 'upcoming') return 'No upcoming tournaments right now.'
    if (filter === 'past') return 'No past tournaments yet.'
    return 'No events to show.'
  })()

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <div className="page-header-row">
          <h1 className="page-title">Tournaments</h1>
          <div className="header-actions">
            <HaveCodeButton autoOpen={openJoin} onAutoOpened={clearJoinParam} initialCode={codeFromSearch} />
            {(user?.role === 'ORGANISER' || user?.role === 'ADMIN') && (
              <Link to="/organiser" className="btn btn-ghost btn-sm">
                Dashboard
              </Link>
            )}
          </div>
        </div>
        <p className="page-sub">
          Organised events. Friend groups live under <Link to="/community">Community</Link>.
        </p>

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
            <p>Could not load tournaments. Please try again.</p>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => refetch()}>
              Retry
            </button>
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
            <p>{emptyMessage}</p>
            {codeFromSearch && (
              <div style={{ marginTop: 12 }}>
                <HaveCodeButton className="btn btn-primary" initialCode={codeFromSearch}>
                  Join with this code
                </HaveCodeButton>
              </div>
            )}
            {tournaments.length > 0 && !codeFromSearch && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setFilter('all')
                  setQuery('')
                }}
              >
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
