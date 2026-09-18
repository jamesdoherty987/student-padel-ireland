import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { platformApi } from '../services/api'

export default function PlayerProfilePage() {
  const { id = '' } = useParams()
  const { data: player, isLoading, isError, refetch } = useQuery({
    queryKey: ['player', id],
    queryFn: async () => (await platformApi.player(id)).data,
    enabled: !!id,
  })

  return (
    <div>
      <NavBar />
      <main className="page">
        {isLoading && (
          <>
            <div className="skeleton" style={{ height: 28, width: '50%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 100 }} />
          </>
        )}
        {isError && (
          <div className="empty-state">
            <h1 className="page-title">Player not found</h1>
            <p className="page-sub">This profile may have been removed.</p>
            <button className="btn btn-ghost" onClick={() => refetch()}>
              Retry
            </button>
            <Link to="/rankings" className="btn btn-primary" style={{ marginLeft: 8 }}>
              Rankings
            </Link>
          </div>
        )}
        {player && (
          <>
            <p className="eyebrow">Student Padel Ireland</p>
            <h1 className="page-title">{player.full_name}</h1>
            <p className="page-sub">{player.university_short || player.university_name || '—'}</p>
            <div className="tour-stats">
              <div>
                <strong>#{player.rank_ireland ?? '—'}</strong>
                <span>Ireland</span>
              </div>
              <div>
                <strong>{player.points}</strong>
                <span>Points</span>
              </div>
              <div>
                <strong>{player.tournaments_played}</strong>
                <span>Tournaments</span>
              </div>
              <div>
                <strong>
                  {player.wins}–{player.losses}
                </strong>
                <span>W–L</span>
              </div>
            </div>
            <p style={{ color: 'var(--muted)' }}>
              Tournament history appears here after events are completed and verified. Email and phone stay private.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
