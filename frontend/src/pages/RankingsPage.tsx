import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { platformApi } from '../services/api'
import { mediaUrl } from '../utils/media'
import './Tournament.css'

export default function RankingsPage() {
  const { data: rankings = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['rankings'],
    queryFn: async () => (await platformApi.rankings(100)).data,
  })

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <h1 className="page-title">Ireland rankings</h1>
        <p className="page-sub">
          Elo starts at 1500. Tournament results and confirmed community matches both count.
        </p>

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

        {rankings.length > 0 && (
          <ol className="rank-page-list">
            {rankings.map((r) => {
              const avatar = mediaUrl(r.avatar_url)
              const initials = r.full_name
                .split(' ')
                .map((p) => p[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()
              return (
                <li key={r.id}>
                  <Link to={`/players/${r.id}`} className="rank-page-row">
                    <span className="rank-num">#{r.rank_ireland ?? '—'}</span>
                    {avatar ? (
                      <img src={avatar} alt="" className="rank-avatar" />
                    ) : (
                      <span className="rank-avatar placeholder" aria-hidden>
                        {initials}
                      </span>
                    )}
                    <span>
                      <strong>{r.full_name}</strong>
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
      </main>
    </div>
  )
}
