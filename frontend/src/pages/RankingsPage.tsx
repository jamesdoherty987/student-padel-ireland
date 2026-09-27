import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { platformApi } from '../services/api'
import { mediaUrl } from '../utils/media'
import './Tournament.css'

export default function RankingsPage() {
  const { user } = useAuth()
  const [uni, setUni] = useState('all')
  const { data: rankings = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['rankings'],
    queryFn: async () => (await platformApi.rankings(100)).data,
  })

  const universities = useMemo(() => {
    const names = new Set<string>()
    for (const r of rankings) {
      const label = r.university_short || r.university_name
      if (label) names.add(label)
    }
    return [...names].sort()
  }, [rankings])

  const visible = useMemo(() => {
    if (uni === 'all') return rankings
    return rankings.filter((r) => (r.university_short || r.university_name) === uni)
  }, [rankings, uni])

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <h1 className="page-title">Ireland rankings</h1>
        <p className="page-sub">
          Elo starts at 1500. Tournament results and confirmed community matches both count.
        </p>

        {universities.length > 1 && (
          <div className="tour-toolbar">
            <label className="form-label" htmlFor="rank-uni" style={{ margin: 0 }}>
              University
            </label>
            <select
              id="rank-uni"
              className="form-select tour-search"
              value={uni}
              onChange={(e) => setUni(e.target.value)}
            >
              <option value="all">All universities</option>
              {universities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        {isLoading && (
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

        {!isLoading && !isError && rankings.length === 0 && (
          <div className="empty-state">
            <p>No ranked players yet — play a community match or finish a tournament.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <Link to="/community" className="btn btn-primary">
                Community
              </Link>
              <Link to="/tournaments" className="btn btn-ghost">
                Tournaments
              </Link>
            </div>
          </div>
        )}

        {visible.length > 0 && (
          <ol className="rank-page-list">
            {visible.map((r) => {
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
                    <span className="rank-num">#{r.rank_ireland ?? '—'}</span>
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
                        {r.university_short || r.university_name || '—'} · {r.wins}W–{r.losses}L
                      </span>
                    </span>
                    <strong className="rank-pts">{r.points}</strong>
                  </Link>
                </li>
              )
            })}
          </ol>
        )}

        {!isLoading && !isError && rankings.length > 0 && visible.length === 0 && (
          <div className="empty-state">
            <p>No ranked players from that university yet.</p>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setUni('all')}>
              Show all
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
