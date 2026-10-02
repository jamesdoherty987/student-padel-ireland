import { useMemo, useState, useCallback, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { HaveCodeButton } from '../components/JoinCodeModal'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, communityApi, tournamentApi } from '../services/api'
import { looksLikeInviteCode, cleanInviteCode } from '../utils/inviteCode'
import { formatDate, statusBadgeClass, statusLabel } from '../utils/format'
import './Tournament.css'
import './Community.css'

const KIND_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'official', label: 'Official' },
  { id: 'community', label: 'Community' },
] as const

const STATUS_FILTERS = [
  { id: 'all', label: 'Any status' },
  { id: 'open', label: 'Open to join' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
] as const

const FORMATS = [
  { id: 'DOUBLES', title: 'Doubles', blurb: '2 vs 2' },
  { id: 'SINGLES', title: 'Singles', blurb: '1 vs 1' },
  { id: 'MIXED', title: 'Both', blurb: 'Singles and doubles' },
] as const

type UnifiedEvent = {
  key: string
  kind: 'official' | 'community'
  name: string
  href: string
  status: string
  line: string
  meta: string
  sortDate: string
}

export default function TournamentsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [kind, setKind] = useState<(typeof KIND_FILTERS)[number]['id']>('all')
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]['id']>('all')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [compName, setCompName] = useState('')
  const [compFormat, setCompFormat] = useState('DOUBLES')
  const [courts, setCourts] = useState(2)
  const [selectedFriends, setSelectedFriends] = useState<string[]>([])
  const [error, setError] = useState('')
  const openJoin = searchParams.get('join') === '1'
  const codeFromSearch = looksLikeInviteCode(query) ? cleanInviteCode(query) : ''

  const clearJoinParam = useCallback(() => {
    if (!openJoin) return
    const next = new URLSearchParams(searchParams)
    next.delete('join')
    setSearchParams(next, { replace: true })
  }, [openJoin, searchParams, setSearchParams])

  const { data: tournaments = [], isLoading: toursLoading, isError: toursError, refetch: refetchTours } = useQuery({
    queryKey: ['tournaments'],
    queryFn: async () => (await tournamentApi.list()).data,
  })

  const compsQ = useQuery({
    queryKey: ['community-home'],
    queryFn: async () => (await communityApi.home()).data,
    enabled: !!user,
  })

  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user && createOpen,
  })

  const acceptedFriends = useMemo(
    () => (friendsQ.data || []).filter((f) => f.direction === 'friend'),
    [friendsQ.data],
  )

  const createMut = useMutation({
    mutationFn: () =>
      communityApi.createCompetition({
        name: compName,
        format: compFormat,
        number_of_courts: courts,
        friend_ids: selectedFriends,
      }),
    onSuccess: (res) => {
      setError('')
      setCreateOpen(false)
      setCompName('')
      setSelectedFriends([])
      qc.invalidateQueries({ queryKey: ['community-home'] })
      navigate(`/community/${res.data.slug}`)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const events = useMemo(() => {
    const list: UnifiedEvent[] = []
    for (const t of tournaments) {
      if (t.status === 'DRAFT') continue
      list.push({
        key: `t-${t.id}`,
        kind: 'official',
        name: t.name,
        href: `/t/${t.slug}`,
        status: t.status,
        line: `${t.location} · ${t.venue}`,
        meta: `${formatDate(t.event_date, { weekday: 'short', day: 'numeric', month: 'short' })} · €${(t.entry_fee_cents / 100).toFixed(0)}/player`,
        sortDate: t.event_date,
      })
    }
    for (const c of compsQ.data?.competitions || []) {
      list.push({
        key: `c-${c.id}`,
        kind: 'community',
        name: c.name,
        href: `/community/${c.slug}`,
        status: c.status,
        line: `${c.member_count} players · ${c.number_of_courts || 2} courts · ${labelFormat(c.format)}`,
        meta: `Host ${c.created_by_name}${c.invite_code ? ` · code ${c.invite_code}` : ''}`,
        sortDate: c.status === 'LIVE' ? '9999-12-31' : c.status === 'OPEN' ? '9999-06-01' : '1970-01-01',
      })
    }
    const statusRank = (status: string, kind: string) => {
      if (kind === 'official') {
        if (status === 'LIVE') return 0
        if (status === 'REGISTRATION_OPEN') return 1
        if (status === 'REGISTRATION_CLOSED') return 2
        if (status === 'COMPLETED' || status === 'CANCELLED') return 4
        return 3
      }
      if (status === 'LIVE') return 0
      if (status === 'OPEN') return 1
      if (status === 'COMPLETED' || status === 'CANCELLED') return 4
      return 3
    }
    return list.sort((a, b) => {
      const ra = statusRank(a.status, a.kind)
      const rb = statusRank(b.status, b.kind)
      if (ra !== rb) return ra - rb
      return b.sortDate.localeCompare(a.sortDate)
    })
  }, [tournaments, compsQ.data?.competitions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (looksLikeInviteCode(query)) return []
    return events.filter((e) => {
      if (kind === 'official' && e.kind !== 'official') return false
      if (kind === 'community' && e.kind !== 'community') return false

      if (e.kind === 'official') {
        if (filter === 'open' && e.status !== 'REGISTRATION_OPEN') return false
        if (filter === 'live' && e.status !== 'LIVE') return false
        if (filter === 'upcoming' && e.status !== 'REGISTRATION_OPEN' && e.status !== 'REGISTRATION_CLOSED') {
          return false
        }
        if (filter === 'past' && e.status !== 'COMPLETED' && e.status !== 'CANCELLED') return false
      } else {
        if (filter === 'open' && e.status !== 'OPEN') return false
        if (filter === 'live' && e.status !== 'LIVE') return false
        if (filter === 'upcoming' && e.status !== 'OPEN') return false
        if (filter === 'past' && e.status !== 'COMPLETED' && e.status !== 'CANCELLED') return false
      }

      if (!q) return true
      return `${e.name} ${e.line} ${e.meta}`.toLowerCase().includes(q)
    })
  }, [events, kind, filter, query])

  const isLoading = toursLoading || (!!user && compsQ.isLoading)
  const isError = toursError
  const compsFailed = !!user && compsQ.isError && !compsQ.isLoading

  const retryLoad = () => {
    void refetchTours()
    if (user) void compsQ.refetch()
  }

  const emptyMessage = (() => {
    if (events.length === 0) {
      return user
        ? 'No tournaments yet. Create one or check back soon.'
        : 'No tournaments yet. Log in to create a community event, or check back soon.'
    }
    if (codeFromSearch) return 'That looks like an invite code, not a search.'
    if (query.trim()) return 'No events match that search.'
    if (kind === 'official') return 'No official tournaments match.'
    if (kind === 'community') {
      return user
        ? 'No community tournaments yet. Create one for your friends.'
        : 'Log in to see and create community tournaments.'
    }
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
            <HaveCodeButton className="btn btn-ghost btn-sm" autoOpen={openJoin} onAutoOpened={clearJoinParam} initialCode={codeFromSearch} />
            {user && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setCreateOpen(true)
                  setError('')
                }}
              >
                Create
              </button>
            )}
            {user && (
              <Link to="/organiser" className="btn btn-ghost btn-sm">
                My events
              </Link>
            )}
          </div>
        </div>
        <p className="page-sub">
          Join official brackets or friend tournaments. Host your own from Create or My events.
        </p>

        {error && <p className="form-error">{error}</p>}

        {createOpen && user && (
          <form
            className="community-panel"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              setError('')
              createMut.mutate()
            }}
          >
            <h2>Create a tournament</h2>
            <p className="muted-note" style={{ marginBottom: 12 }}>
              Friend open-play below, or{' '}
              <Link to="/organiser?create=1">run a full bracket</Link> (groups, knockout, live scoring).
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="comp-name">
                Name
              </label>
              <input
                id="comp-name"
                className="form-input"
                value={compName}
                onChange={(e) => setCompName(e.target.value)}
                placeholder="Friday padel"
                required
                minLength={3}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Play style</label>
              <div className="format-grid">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`format-card ${compFormat === f.id ? 'on' : ''}`}
                    onClick={() => setCompFormat(f.id)}
                  >
                    <strong>{f.title}</strong>
                    <span>{f.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="comp-courts">
                Courts available
              </label>
              <select
                id="comp-courts"
                className="form-select"
                value={courts}
                onChange={(e) => setCourts(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} court{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </div>
            {acceptedFriends.length > 0 && (
              <div className="form-group">
                <label className="form-label">Invite friends now</label>
                <div className="friend-chip-row">
                  {acceptedFriends.map((f) => (
                    <button
                      key={f.user_id}
                      type="button"
                      className={`friend-chip ${selectedFriends.includes(f.user_id) ? 'on' : ''}`}
                      onClick={() =>
                        setSelectedFriends((prev) =>
                          prev.includes(f.user_id) ? prev.filter((x) => x !== f.user_id) : [...prev, f.user_id],
                        )
                      }
                    >
                      {f.full_name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={createMut.isPending}>
              {createMut.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginLeft: 8 }}
              onClick={() => {
                setCreateOpen(false)
                setError('')
              }}
            >
              Cancel
            </button>
          </form>
        )}

        <div className="tour-toolbar">
          <div className="tour-toolbar-row">
            <div className="filter-chips filter-chips-subtle" role="tablist" aria-label="Event type">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={kind === f.id}
                  className={`filter-chip filter-chip-subtle ${kind === f.id ? 'on' : ''}`}
                  onClick={() => setKind(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
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

        {compsFailed && !isError && (
          <p className="form-error" style={{ marginBottom: 12 }}>
            Could not load your community events.{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void compsQ.refetch()}>
              Retry
            </button>
          </p>
        )}
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
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={retryLoad}>
              Retry
            </button>
          </div>
        )}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="tour-list">
            {filtered.map((e) => (
              <Link key={e.key} to={e.href} className="tour-card-link">
                <article className={`tour-card ${e.kind === 'community' ? 'community-card' : ''}`}>
                  <div className="tour-card-top">
                    <h2>{e.name}</h2>
                    <span className="badge-row">
                      <span className={`badge ${e.kind === 'official' ? 'badge-live' : 'badge-draft'}`}>
                        {e.kind === 'official' ? 'Official' : 'Community'}
                      </span>
                      <span className={`badge ${statusBadgeClass(e.status)}`}>
                        {e.kind === 'community' ? labelCompStatus(e.status) : statusLabel(e.status)}
                      </span>
                    </span>
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
                  setKind('all')
                  setFilter('all')
                  setQuery('')
                }}
              >
                Clear filters
              </button>
            )}
            {events.length === 0 && user && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setCreateOpen(true)
                  setError('')
                }}
              >
                Create a tournament
              </button>
            )}
            {!user && events.length === 0 && !codeFromSearch && (
              <Link to="/login?next=%2Ftournaments" className="btn btn-primary" style={{ marginTop: 12 }}>
                Log in to create
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function labelFormat(f: string) {
  if (f === 'SINGLES') return 'Singles'
  if (f === 'MIXED') return 'Mixed'
  return 'Doubles'
}

function labelCompStatus(s: string) {
  if (s === 'OPEN') return 'Open'
  if (s === 'LIVE') return 'Live'
  if (s === 'COMPLETED') return 'Past'
  if (s === 'CANCELLED') return 'Cancelled'
  return s.charAt(0) + s.slice(1).toLowerCase()
}
