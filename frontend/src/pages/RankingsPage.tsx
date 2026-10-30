import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { communityApi, platformApi } from '../services/api'
import { mediaUrl } from '../utils/media'
import './Tournament.css'

const SCOPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'events', label: 'My events' },
  { id: 'friends', label: 'Friends' },
  { id: 'university', label: 'My university' },
] as const

type ScopeId = (typeof SCOPE_FILTERS)[number]['id']

function isScopeId(value: string | null): value is ScopeId {
  return value === 'all' || value === 'events' || value === 'friends' || value === 'university'
}

export default function RankingsPage() {
  usePageSeo({
    title: 'Ireland Student Padel Rankings',
    description:
      'Live Ireland student padel rankings on Student Padel Ireland. See standings from tournaments and community matches nationwide.',
    path: '/rankings',
  })
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const scopeParam = searchParams.get('scope')
  const lockedScopes: ScopeId[] = ['events', 'friends', 'university']
  const initialScope: ScopeId =
    isScopeId(scopeParam) && (scopeParam === 'all' || user) ? scopeParam : 'all'
  const [scope, setScope] = useState<ScopeId>(initialScope)
  const [uni, setUni] = useState('all')

  useEffect(() => {
    if (authLoading) return
    // Locked scopes need an account - keep guests on the public board
    if (!user && isScopeId(scopeParam) && lockedScopes.includes(scopeParam)) {
      setScope('all')
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.delete('scope')
          return params
        },
        { replace: true },
      )
      return
    }
    if (isScopeId(scopeParam)) {
      setScope(scopeParam)
    }
  }, [scopeParam, user, authLoading, setSearchParams])

  const { data: rankings = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['rankings'],
    queryFn: async () => (await platformApi.rankings(100)).data,
    enabled: scope !== 'events',
  })

  const myEventsQ = useQuery({
    queryKey: ['rankings', 'my-events'],
    queryFn: async () => (await platformApi.rankingsMyEvents(100)).data,
    enabled: !!user && scope === 'events',
  })

  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user,
  })

  const meQ = useQuery({
    queryKey: ['player', user?.id],
    queryFn: async () => (await platformApi.player(user!.id)).data,
    enabled: !!user,
  })

  const friendIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of friendsQ.data || []) {
      if (f.direction === 'friend') ids.add(f.user_id)
    }
    if (user) ids.add(user.id)
    return ids
  }, [friendsQ.data, user])

  const myUniShort = meQ.data?.university_short || ''
  const myUniName = meQ.data?.university_name || ''

  const sourceRows = scope === 'events' ? myEventsQ.data || [] : rankings

  const universities = useMemo(() => {
    const names = new Set<string>()
    for (const r of sourceRows) {
      const label = r.university_short || r.university_name
      if (label) names.add(label)
    }
    return [...names].sort()
  }, [sourceRows])

  const visible = useMemo(() => {
    let rows = sourceRows
    if (scope === 'friends') {
      if (!user) return []
      rows = rows.filter((r) => friendIds.has(r.id))
    } else if (scope === 'university') {
      if (!user || (!myUniShort && !myUniName)) return []
      rows = rows.filter((r) => {
        const label = r.university_short || r.university_name || ''
        return label === myUniShort || label === myUniName
      })
    }
    if (uni !== 'all' && scope === 'all') {
      rows = rows.filter((r) => (r.university_short || r.university_name) === uni)
    }
    return rows
  }, [sourceRows, scope, uni, friendIds, user, myUniShort, myUniName])

  const scopeLoading =
    (scope === 'events' && !!user && myEventsQ.isLoading) ||
    (scope === 'friends' && !!user && friendsQ.isLoading) ||
    (scope === 'university' && !!user && meQ.isLoading)

  const listLoading = scope === 'events' ? myEventsQ.isLoading : isLoading
  const listError = scope === 'events' ? myEventsQ.isError : isError
  const listRefetch = scope === 'events' ? () => void myEventsQ.refetch() : () => void refetch()

  const setScopeAndUrl = (next: ScopeId) => {
    setScope(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('scope')
    else params.set('scope', next)
    setSearchParams(params, { replace: true })
    if (next !== 'all') setUni('all')
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <h1 className="page-title">Ireland rankings</h1>
        <p className="page-sub">
          {scope === 'events'
            ? 'Players from tournaments you’re entered in, ordered by rating.'
            : 'Rating points from confirmed tournament and community matches. New players start at 1500.'}
        </p>

        <div className="tour-toolbar">
          <div className="filter-chips filter-chips-subtle" role="tablist" aria-label="Rankings scope">
            {SCOPE_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={scope === f.id}
                className={`filter-chip filter-chip-subtle ${scope === f.id ? 'on' : ''}${
                  f.id !== 'all' && !user ? ' is-locked' : ''
                }`}
                onClick={() => {
                  if (f.id !== 'all' && !user) {
                    navigate(`/login?next=${encodeURIComponent(`/rankings?scope=${f.id}`)}`)
                    return
                  }
                  setScopeAndUrl(f.id)
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {universities.length > 1 && scope === 'all' && (
            <select
              id="rank-uni"
              className="form-select tour-search"
              value={uni}
              onChange={(e) => setUni(e.target.value)}
              aria-label="University"
            >
              <option value="all">All universities</option>
              {universities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {!user && (
            <p className="muted-note" style={{ margin: 0 }}>
              Tap My events, Friends, or My university to log in and filter.
            </p>
          )}
        </div>

        {(listLoading || scopeLoading) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton" style={{ height: 56, borderRadius: 12 }} />
            ))}
          </div>
        )}

        {listError && (
          <div className="empty-state">
            <p>Could not load rankings.</p>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={listRefetch}>
              Retry
            </button>
          </div>
        )}

        {!listLoading && !scopeLoading && !listError && sourceRows.length === 0 && scope === 'events' && (
          <div className="empty-state">
            <p>Join a tournament to see rankings for players in your events.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <Link to="/tournaments" className="btn btn-primary">
                Browse tournaments
              </Link>
              <button type="button" className="btn btn-ghost" onClick={() => setScopeAndUrl('all')}>
                Show all Ireland
              </button>
            </div>
          </div>
        )}

        {!listLoading && !scopeLoading && !listError && sourceRows.length === 0 && scope !== 'events' && (
          <div className="empty-state">
            <p>No ranked players yet. Play with friends or finish an official tournament match.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <Link to="/community" className="btn btn-primary">
                Play with friends
              </Link>
              <Link to="/tournaments" className="btn btn-ghost">
                Official tournaments
              </Link>
            </div>
          </div>
        )}

        {!listLoading && !scopeLoading && visible.length > 0 && (
          <ol className="rank-page-list">
            {visible.map((r, idx) => {
              const avatar = mediaUrl(r.avatar_url)
              const initials = r.full_name
                .split(' ')
                .map((p) => p[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()
              const isMe = Boolean(user && user.id === r.id)
              const showIrelandRank = scope === 'all' && uni === 'all'
              return (
                <li key={r.id}>
                  <Link to={`/players/${r.id}`} className={`rank-page-row ${isMe ? 'is-me' : ''}`}>
                    <span className="rank-num">#{showIrelandRank ? (r.rank_ireland ?? '-') : idx + 1}</span>
                    {avatar ? (
                      <img src={avatar} alt="" className="rank-avatar" />
                    ) : (
                      <span className="rank-avatar placeholder" aria-hidden>
                        {initials}
                      </span>
                    )}
                    <span>
                      <strong>
                        {r.full_name}
                        {isMe ? ' · you' : ''}
                      </strong>
                      <br />
                      <span className="rank-meta">
                        {r.university_short || r.university_name || '-'} · {r.wins}W-{r.losses}L
                      </span>
                    </span>
                    <strong className="rank-pts">{r.points}</strong>
                  </Link>
                </li>
              )
            })}
          </ol>
        )}

        {!listLoading && !scopeLoading && !listError && scope === 'friends' && friendsQ.isError && (
          <div className="empty-state">
            <p>Could not load your friends list.</p>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() => void friendsQ.refetch()}
            >
              Retry
            </button>
          </div>
        )}

        {!listLoading &&
          !scopeLoading &&
          !listError &&
          !(scope === 'friends' && friendsQ.isError) &&
          sourceRows.length > 0 &&
          visible.length === 0 && (
          <div className="empty-state">
            <p>
              {scope === 'friends'
                ? 'No ranked friends yet. Add friends under Play.'
                : scope === 'university' && !myUniShort && !myUniName
                  ? 'Add your university on Profile to see college rankings.'
                  : scope === 'university'
                    ? 'No ranked players from your university yet.'
                    : 'No ranked players from that university yet.'}
            </p>
            <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              {scope === 'university' && !myUniShort && !myUniName && user && (
                <Link to={`/players/${user.id}`} className="btn btn-primary">
                  Edit profile
                </Link>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setScopeAndUrl('all')
                  setUni('all')
                }}
              >
                Show all
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
