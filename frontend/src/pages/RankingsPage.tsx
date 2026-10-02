import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { communityApi, platformApi } from '../services/api'
import { mediaUrl } from '../utils/media'
import './Tournament.css'

const SCOPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'friends', label: 'Friends' },
  { id: 'university', label: 'My university' },
] as const

export default function RankingsPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const scopeParam = searchParams.get('scope')
  const initialScope =
    scopeParam === 'friends' || scopeParam === 'university' || scopeParam === 'all' ? scopeParam : 'all'
  const [scope, setScope] = useState<(typeof SCOPE_FILTERS)[number]['id']>(initialScope)
  const [uni, setUni] = useState('all')

  useEffect(() => {
    if (scopeParam === 'friends' || scopeParam === 'university' || scopeParam === 'all') {
      setScope(scopeParam)
    }
  }, [scopeParam])

  const { data: rankings = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['rankings'],
    queryFn: async () => (await platformApi.rankings(100)).data,
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

  const universities = useMemo(() => {
    const names = new Set<string>()
    for (const r of rankings) {
      const label = r.university_short || r.university_name
      if (label) names.add(label)
    }
    return [...names].sort()
  }, [rankings])

  const visible = useMemo(() => {
    let rows = rankings
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
    if (uni !== 'all') {
      rows = rows.filter((r) => (r.university_short || r.university_name) === uni)
    }
    return rows
  }, [rankings, scope, uni, friendIds, user, myUniShort, myUniName])

  const scopeLoading =
    (scope === 'friends' && !!user && friendsQ.isLoading) ||
    (scope === 'university' && !!user && meQ.isLoading)

  const setScopeAndUrl = (next: (typeof SCOPE_FILTERS)[number]['id']) => {
    setScope(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('scope')
    else params.set('scope', next)
    setSearchParams(params, { replace: true })
    if (next === 'university') setUni('all')
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <h1 className="page-title">Ireland rankings</h1>
        <p className="page-sub">From tournaments and community matches. Everyone starts at 1500.</p>

        <div className="tour-toolbar">
          <div className="filter-chips filter-chips-subtle" role="tablist" aria-label="Rankings scope">
            {SCOPE_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={scope === f.id}
                className={`filter-chip filter-chip-subtle ${scope === f.id ? 'on' : ''}`}
                onClick={() => setScopeAndUrl(f.id)}
                disabled={f.id !== 'all' && !user}
                title={f.id !== 'all' && !user ? 'Log in to use this filter' : undefined}
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
        </div>

        {(isLoading || scopeLoading) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton" style={{ height: 56, borderRadius: 12 }} />
            ))}
          </div>
        )}

        {isError && (
          <div className="empty-state">
            <p>Could not load rankings.</p>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}

        {!isLoading && !scopeLoading && !isError && rankings.length === 0 && (
          <div className="empty-state">
            <p>No ranked players yet. Play a community match or finish a tournament match.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <Link to="/community" className="btn btn-primary">
                Community
              </Link>
              <Link to="/tournaments" className="btn btn-ghost">
                Browse tournaments
              </Link>
            </div>
          </div>
        )}

        {!isLoading && !scopeLoading && visible.length > 0 && (
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
              return (
                <li key={r.id}>
                  <Link to={`/players/${r.id}`} className={`rank-page-row ${isMe ? 'is-me' : ''}`}>
                    <span className="rank-num">#{scope === 'all' && uni === 'all' ? (r.rank_ireland ?? '-') : idx + 1}</span>
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

        {!isLoading && !scopeLoading && !isError && rankings.length > 0 && visible.length === 0 && (
          <div className="empty-state">
            <p>
              {scope === 'friends'
                ? 'No ranked friends yet. Add friends in Community.'
                : scope === 'university'
                  ? 'No ranked players from your university yet.'
                  : 'No ranked players from that university yet.'}
            </p>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() => {
                setScopeAndUrl('all')
                setUni('all')
              }}
            >
              Show all
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
