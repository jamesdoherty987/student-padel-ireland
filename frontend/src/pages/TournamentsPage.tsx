import { useMemo, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ModeSwitch from '../components/ModeSwitch'
import NavBar from '../components/NavBar'
import { HaveCodeButton } from '../components/JoinCodeModal'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { tournamentApi } from '../services/api'
import { looksLikeInviteCode, cleanInviteCode } from '../utils/inviteCode'
import { formatDate, formatPerPlayerFee, statusBadgeClass, statusLabel } from '../utils/format'
import './Tournament.css'

const STATUS_FILTERS = [
  { id: 'all', label: 'Any status' },
  { id: 'open', label: 'Open to join' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
] as const

export default function TournamentsPage() {
  usePageSeo({
    title: 'Official Student Padel Tournaments in Ireland',
    description:
      'Browse official Student Padel Ireland tournaments across the country. Register as a doubles team, join with a code, and follow live scores.',
    path: '/tournaments',
  })
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]['id']>('all')
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

  const events = useMemo(() => {
    const list = tournaments
      .filter((t) => t.status !== 'DRAFT')
      .map((t) => ({
        key: t.id,
        name: t.name,
        href: `/t/${t.slug}`,
        status: t.status,
        line: `${t.location} · ${t.venue}`,
        meta: `${formatDate(t.event_date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatPerPlayerFee(t.entry_fee_cents, t.currency, t.play_format)}`,
        sortDate: t.event_date,
      }))

    const statusRank = (status: string) => {
      if (status === 'LIVE') return 0
      if (status === 'REGISTRATION_OPEN') return 1
      if (status === 'REGISTRATION_CLOSED') return 2
      if (status === 'COMPLETED' || status === 'CANCELLED') return 4
      return 3
    }

    return list.sort((a, b) => {
      const ra = statusRank(a.status)
      const rb = statusRank(b.status)
      if (ra !== rb) return ra - rb
      return b.sortDate.localeCompare(a.sortDate)
    })
  }, [tournaments])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (looksLikeInviteCode(query)) return []
    return events.filter((e) => {
      if (filter === 'open' && e.status !== 'REGISTRATION_OPEN') return false
      if (filter === 'live' && e.status !== 'LIVE') return false
      if (filter === 'upcoming' && e.status !== 'REGISTRATION_OPEN' && e.status !== 'REGISTRATION_CLOSED') {
        return false
      }
      if (filter === 'past' && e.status !== 'COMPLETED' && e.status !== 'CANCELLED') return false
      if (!q) return true
      return `${e.name} ${e.line} ${e.meta}`.toLowerCase().includes(q)
    })
  }, [events, filter, query])

  const emptyMessage = (() => {
    if (events.length === 0) return 'No official tournaments listed yet. Check back soon.'
    if (codeFromSearch) return 'That looks like an invite code — tap below to join.'
    if (query.trim()) return 'No tournaments match that search.'
    if (filter === 'open') return 'No tournaments open to join right now.'
    if (filter === 'live') return 'No live tournaments right now.'
    if (filter === 'upcoming') return 'No upcoming tournaments right now.'
    if (filter === 'past') return 'No past tournaments yet.'
    return 'No tournaments to show.'
  })()

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <div className="page-header-row">
          <h1 className="page-title">Tournaments</h1>
          <div className="header-actions">
            <HaveCodeButton
              className="btn btn-ghost btn-sm"
              autoOpen={openJoin}
              onAutoOpened={clearJoinParam}
              initialCode={codeFromSearch}
            />
          </div>
        </div>

        <ModeSwitch active="tournaments" />
        <p className="page-sub page-sub-tight">Official Student Padel Ireland events</p>

        <div className="tour-toolbar">
          <div className="tour-toolbar-row tour-toolbar-row-solo">
            <select
              className="form-select tour-status-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value as (typeof STATUS_FILTERS)[number]['id'])}
              aria-label="Filter by status"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              className="form-input tour-search tour-search-inline"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city, venue, or name"
              aria-label="Search tournaments"
            />
          </div>
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
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        )}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="tour-list">
            {filtered.map((e) => (
              <Link key={e.key} to={e.href} className="tour-card-link">
                <article className="tour-card">
                  <div className="tour-card-top">
                    <h2>{e.name}</h2>
                    <span className={`badge ${statusBadgeClass(e.status)}`}>{statusLabel(e.status)}</span>
                  </div>
                  <p>{e.line}</p>
                  <p className="tour-card-meta">{e.meta}</p>
                </article>
              </Link>
            ))}
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="empty-state">
            <p>{emptyMessage}</p>
            {codeFromSearch && (
              <div style={{ marginTop: 12 }}>
                <HaveCodeButton className="btn btn-primary btn-sm" initialCode={codeFromSearch}>
                  Join with this code
                </HaveCodeButton>
              </div>
            )}
            {events.length > 0 && !codeFromSearch && (
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
            {events.length === 0 && !codeFromSearch && (
              <div className="header-actions" style={{ marginTop: 12, justifyContent: 'center' }}>
                <Link to="/community" className="btn btn-primary">
                  Play with friends
                </Link>
                {user ? (
                  <Link to="/organiser?create=1" className="btn btn-ghost">
                    Private tournament
                  </Link>
                ) : (
                  <Link to="/login?next=%2Ftournaments" className="btn btn-ghost">
                    Log in
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
