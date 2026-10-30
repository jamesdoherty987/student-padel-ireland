import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import CreateTournamentModal from '../components/CreateTournamentModal'
import { HaveCodeButton } from '../components/JoinCodeModal'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { tournamentApi } from '../services/api'
import { looksLikeInviteCode, cleanInviteCode } from '../utils/inviteCode'
import { formatDate, formatPerPlayerFee, statusLabel } from '../utils/format'
import './Tournament.css'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'official', label: 'Official' },
  { id: 'mine', label: 'Owned by me' },
  { id: 'open', label: 'Open to join' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
] as const

type FilterId = (typeof FILTERS)[number]['id']

export default function TournamentsPage() {
  usePageSeo({
    title: 'Student Padel Tournaments in Ireland',
    description:
      'Browse official and personal student padel tournaments across Ireland. Open an event to see your entry, next match, court, and time.',
    path: '/tournaments',
  })
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const filterParam = searchParams.get('filter')
  const initialFilter: FilterId =
    filterParam && FILTERS.some((f) => f.id === filterParam) ? (filterParam as FilterId) : 'all'
  const [filter, setFilter] = useState<FilterId>(initialFilter)
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(searchParams.get('create') === '1')
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)
  const openJoin = searchParams.get('join') === '1'
  const codeFromSearch = looksLikeInviteCode(query) ? cleanInviteCode(query) : ''

  const setFilterAndUrl = (next: FilterId) => {
    setFilter(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('filter')
    else params.set('filter', next)
    setSearchParams(params, { replace: true })
  }

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  useEffect(() => {
    const next: FilterId =
      filterParam && FILTERS.some((f) => f.id === filterParam) ? (filterParam as FilterId) : 'all'
    setFilter(next)
  }, [filterParam])

  useEffect(() => {
    if (searchParams.get('create') !== '1') return
    if (!user) {
      navigate('/login?next=%2Ftournaments%3Fcreate%3D1', { replace: true })
      return
    }
    setShowCreate(true)
  }, [searchParams, user, navigate])

  useEffect(() => {
    if (user || searchParams.get('filter') !== 'mine') return
    const next = new URLSearchParams(searchParams)
    next.delete('filter')
    setSearchParams(next, { replace: true })
    setFilter('all')
  }, [user, searchParams, setSearchParams])

  const clearCreateParam = useCallback(() => {
    if (searchParams.get('create') !== '1') return
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const openCreate = () => {
    if (!user) {
      navigate('/login?next=%2Ftournaments%3Fcreate%3D1')
      return
    }
    setShowCreate(true)
  }

  const closeCreate = () => {
    setShowCreate(false)
    clearCreateParam()
  }

  const clearJoinParam = useCallback(() => {
    if (!openJoin) return
    const next = new URLSearchParams(searchParams)
    next.delete('join')
    setSearchParams(next, { replace: true })
  }, [openJoin, searchParams, setSearchParams])

  const { data: tournaments = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['tournaments', user?.id || 'guest'],
    queryFn: async () => (await tournamentApi.list()).data,
  })

  const events = useMemo(() => {
    const list = tournaments
      .filter((t) => {
        if (t.status !== 'DRAFT') return true
        // Owners still see their drafts under Owned by me / All
        return !!user && (t.organiser_id === user.id || !!t.can_manage)
      })
      .map((t) => ({
        key: t.id,
        name: t.name,
        href: `/t/${t.slug}`,
        status: t.status,
        official: !!t.is_official,
        entered: !!t.viewer_entered,
        owned: !!user && (t.organiser_id === user.id || !!t.can_manage),
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
      const ra = statusRank(a.status) - (a.entered ? 0.4 : 0)
      const rb = statusRank(b.status) - (b.entered ? 0.4 : 0)
      if (ra !== rb) return ra - rb
      return b.sortDate.localeCompare(a.sortDate)
    })
  }, [tournaments, user])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (looksLikeInviteCode(query)) return []
    return events.filter((e) => {
      if (filter === 'official' && !e.official) return false
      if (filter === 'mine' && !e.owned) return false
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
    if (events.length === 0) {
      return user
        ? 'No tournaments yet. Join with a code, or create one.'
        : 'No tournaments listed yet. Log in or check back soon.'
    }
    if (codeFromSearch) return 'That looks like an invite code — tap below to join.'
    if (query.trim()) return 'No tournaments match that search.'
    if (filter === 'official') return 'No official tournaments match.'
    if (filter === 'mine') {
      return user ? 'You don’t own any tournaments yet.' : 'Log in to see tournaments you own.'
    }
    if (filter === 'open') return 'No tournaments open to join right now.'
    if (filter === 'live') return 'No live tournaments right now.'
    if (filter === 'upcoming') return 'No upcoming tournaments right now.'
    if (filter === 'past') return 'No past tournaments yet.'
    return 'No tournaments to show.'
  })()

  const visibleFilters = FILTERS.filter((f) => f.id !== 'mine' || !!user)

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        {toast && (
          <div className="org-toast" role="status">
            {toast}
          </div>
        )}
        <div className="page-header-row page-header-row--inline">
          <h1 className="page-title">Tournaments</h1>
          <div className="header-actions header-actions--tour">
            <HaveCodeButton
              className="btn btn-ghost btn-sm"
              autoOpen={openJoin}
              onAutoOpened={clearJoinParam}
              initialCode={codeFromSearch}
            >
              Code
            </HaveCodeButton>
            <button type="button" className="btn btn-primary btn-sm btn-new-tour" onClick={openCreate}>
              <i className="fas fa-plus" aria-hidden />
              New
            </button>
          </div>
        </div>
        <p className="page-sub page-sub-tight">Tap a tournament for courts, opponents, and times</p>

        <div className="tour-toolbar">
          <div className="tour-toolbar-row tour-toolbar-inline">
            <select
              className="form-select tour-filter-select"
              value={filter}
              onChange={(e) => setFilterAndUrl(e.target.value as FilterId)}
              aria-label="Filter tournaments"
            >
              {visibleFilters.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              className="form-input tour-search-compact"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
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
                <article className={`tour-card tour-card--simple${e.entered ? ' tour-card--entered' : ''}`}>
                  <h2>{e.name}</h2>
                  <p className="tour-card-kind">
                    {e.entered ? (
                      <span className="tour-card-in">You’re in</span>
                    ) : e.owned ? (
                      <span className="tour-card-in">Organiser</span>
                    ) : null}
                    {e.entered || e.owned ? <span aria-hidden> · </span> : null}
                    <span>{e.official ? 'Official' : 'Personal'}</span>
                    <span aria-hidden> · </span>
                    <span>{statusLabel(e.status)}</span>
                  </p>
                  <p className="tour-card-line">{e.line}</p>
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
                  setFilterAndUrl('all')
                  setQuery('')
                }}
              >
                Clear filters
              </button>
            )}
            {events.length === 0 && !codeFromSearch && (
              <div className="header-actions header-actions--tour" style={{ marginTop: 12, justifyContent: 'center' }}>
                <button type="button" className="btn btn-primary btn-sm btn-new-tour" onClick={openCreate}>
                  <i className="fas fa-plus" aria-hidden />
                  New
                </button>
                <HaveCodeButton className="btn btn-ghost btn-sm">Code</HaveCodeButton>
              </div>
            )}
            {filter === 'mine' && events.length > 0 && !codeFromSearch && (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-primary btn-sm btn-new-tour" onClick={openCreate}>
                  <i className="fas fa-plus" aria-hidden />
                  New tournament
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {showCreate && user && (
        <CreateTournamentModal
          variant="organiser"
          onClose={closeCreate}
          onToast={showToast}
          onCreated={(msg, id) => {
            showToast(msg)
            closeCreate()
            if (id) navigate(`/organiser?t=${id}`)
          }}
        />
      )}
    </div>
  )
}
