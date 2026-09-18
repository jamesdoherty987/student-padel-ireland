import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { platformApi } from '../services/api'
import './Tournament.css'

export default function RankingsPage() {
  const { data: rankings = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['rankings'],
    queryFn: async () => (await platformApi.rankings(100)).data,
  })

  return (
    <div>
      <NavBar />
      <main className="page">
        <h1 className="page-title">Ireland rankings</h1>
        <p className="page-sub">Points update after verified tournament results.</p>

        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton" style={{ height: 52 }} />
            ))}
          </div>
        )}

        {isError && (
          <div className="empty-state">
            <p>Could not load rankings.</p>
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && rankings.length === 0 && (
          <div className="empty-state">
            <p>No ranked players yet — complete a tournament to populate the board.</p>
            <Link to="/tournaments" className="btn btn-primary" style={{ marginTop: 12 }}>
              Find a tournament
            </Link>
          </div>
        )}

        <ol className="rank-page-list">
          {rankings.map((r) => (
            <li key={r.id}>
              <Link to={`/players/${r.id}`} className="rank-page-row">
                <span className="rank-num">#{r.rank_ireland ?? '—'}</span>
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
          ))}
        </ol>
      </main>
    </div>
  )
}
