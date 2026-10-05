import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import {
  apiErrorMessage,
  communityApi,
  platformApi,
  type CommunityMatch,
  type Friendship,
} from '../services/api'
import './Tournament.css'
import './Community.css'

export default function CommunityPage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [friendsAutoOpened, setFriendsAutoOpened] = useState(false)

  const homeQ = useQuery({
    queryKey: ['community-home'],
    queryFn: async () => (await communityApi.home()).data,
    enabled: !!user,
    refetchInterval: 15000,
  })
  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user,
  })
  const searchQ = useQuery({
    queryKey: ['player-search', search],
    queryFn: async () => (await communityApi.searchPlayers(search)).data,
    enabled: !!user && search.trim().length >= 2,
  })
  const meQ = useQuery({
    queryKey: ['player', user?.id],
    queryFn: async () => (await platformApi.player(user!.id)).data,
    enabled: !!user,
  })

  const accepted = useMemo(
    () => (friendsQ.data || []).filter((f) => f.direction === 'friend'),
    [friendsQ.data],
  )
  const incoming = useMemo(
    () => (friendsQ.data || []).filter((f) => f.direction === 'incoming'),
    [friendsQ.data],
  )
  const outgoing = useMemo(
    () => (friendsQ.data || []).filter((f) => f.direction === 'outgoing'),
    [friendsQ.data],
  )
  const needsConfirm = homeQ.data?.needs_confirm || []
  const needsScore = homeQ.data?.needs_score || []
  const nextMatches = homeQ.data?.my_next_matches || []
  const confirmIds = useMemo(
    () => new Set((homeQ.data?.needs_confirm || []).map((m) => m.id)),
    [homeQ.data?.needs_confirm],
  )
  const nextGame = nextMatches.find((m) => !confirmIds.has(m.id)) || nextMatches[0]

  const myUniversity = meQ.data?.university_short || meQ.data?.university_name || ''
  const collegeMates = useMemo(() => {
    if (!myUniversity) return []
    const short = meQ.data?.university_short || ''
    const full = meQ.data?.university_name || ''
    return accepted.filter((f) => {
      const label = f.university_short || ''
      return Boolean(label && (label === short || label === full || label === myUniversity))
    })
  }, [accepted, myUniversity, meQ.data?.university_short, meQ.data?.university_name])

  useEffect(() => {
    if (friendsAutoOpened || incoming.length === 0) return
    setFriendsOpen(true)
    setFriendsAutoOpened(true)
  }, [incoming.length, friendsAutoOpened])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['community-home'] })
    qc.invalidateQueries({ queryKey: ['friends'] })
    qc.invalidateQueries({ queryKey: ['player-search'] })
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const requestMut = useMutation({
    mutationFn: (userId: string) => communityApi.requestFriend(userId),
    onSuccess: () => {
      setError('')
      refresh()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const acceptMut = useMutation({
    mutationFn: (id: string) => communityApi.acceptFriend(id),
    onSuccess: () => {
      setError('')
      refresh()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const removeMut = useMutation({
    mutationFn: (id: string) => communityApi.removeFriend(id),
    onSuccess: () => {
      setError('')
      refresh()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const confirmMut = useMutation({
    mutationFn: (id: string) => communityApi.confirmMatch(id),
    onSuccess: () => {
      setError('')
      refresh()
      qc.invalidateQueries({ queryKey: ['rankings'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  useEffect(() => {
    const code = params.get('code')
    if (code && code.trim().length >= 6) {
      navigate(`/join/${encodeURIComponent(code.trim().toUpperCase())}`, { replace: true })
    }
  }, [params, navigate])

  if (authLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '40%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </main>
      </div>
    )
  }

  if (!user) {
    const next = encodeURIComponent('/community')
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <h1 className="page-title">Community</h1>
          <p className="page-sub">
            Friends, college mates, and match confirmations. Events live under{' '}
            <Link to="/tournaments">Tournaments</Link>.
          </p>
          <div className="community-guest-actions" style={{ marginBottom: '1.25rem' }}>
            <Link to={`/signup?next=${next}`} className="btn btn-primary">
              Sign up
            </Link>
            <Link to={`/login?next=${next}`} className="btn btn-ghost">
              Log in
            </Link>
          </div>
          <ol className="community-guest-steps">
            <li>
              <strong>Add friends</strong>
              <span>Search by name and send a request.</span>
            </li>
            <li>
              <strong>Find college mates</strong>
              <span>See who else plays from your university on Rankings.</span>
            </li>
            <li>
              <strong>Play and confirm</strong>
              <span>Both sides confirm the score before ratings update.</span>
            </li>
          </ol>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <div className="page-header-row">
          <h1 className="page-title">Community</h1>
        </div>
        <p className="page-sub">
          Friends and college mates. Create or join events under{' '}
          <Link to="/tournaments">Tournaments</Link>.
        </p>

        {error && <p className="form-error">{error}</p>}

        {homeQ.isLoading && (
          <>
            <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 80 }} />
          </>
        )}

        {homeQ.isError && (
          <div className="empty-state">
            <p>Could not load community right now.</p>
            <button type="button" className="btn btn-ghost" onClick={() => homeQ.refetch()}>
              Retry
            </button>
          </div>
        )}

        {!homeQ.isLoading && !homeQ.isError && nextGame && (
          <section className="next-game-hero">
            <div className="next-game-label">Your next game</div>
            <div className="next-game-court">
              {nextGame.court_number ? `Court ${nextGame.court_number}` : 'Court TBC'}
            </div>
            <div className="next-game-vs">
              <span>{sideLabel(nextGame, 'A')}</span>
              <em>vs</em>
              <span>{sideLabel(nextGame, 'B')}</span>
            </div>
            <div className="next-game-meta">
              {nextGame.competition_name}
              {nextGame.status === 'AWAITING_CONFIRM' ? ' · waiting for confirm' : ''}
            </div>
            <div className="next-game-actions">
              {nextGame.needs_my_confirm && (
                <button
                  type="button"
                  className="btn btn-dark btn-sm"
                  disabled={confirmMut.isPending}
                  onClick={() => confirmMut.mutate(nextGame.id)}
                >
                  {confirmMut.isPending ? 'Confirming…' : 'Confirm score'}
                </button>
              )}
              {nextGame.can_i_score && (
                <Link to={`/community/${nextGame.competition_slug}`} className="btn btn-dark btn-sm">
                  Enter score
                </Link>
              )}
              <Link to={`/community/${nextGame.competition_slug}`} className="btn btn-ghost btn-sm">
                Open event
              </Link>
            </div>
          </section>
        )}

        {(() => {
          const confirmCards = needsConfirm.filter((m) => m.id !== nextGame?.id)
          const scoreCards = needsScore.filter((m) => m.id !== nextGame?.id)
          if (confirmCards.length === 0 && scoreCards.length === 0) return null
          return (
            <section className="up-next">
              <h2>Needs you</h2>
              {confirmCards.map((m) => (
                <ActionCard
                  key={m.id}
                  title="Confirm score"
                  match={m}
                  actionLabel={confirmMut.isPending ? 'Confirming…' : 'Confirm'}
                  disabled={confirmMut.isPending}
                  onAction={() => confirmMut.mutate(m.id)}
                />
              ))}
              {scoreCards.map((m) => (
                <ActionCard
                  key={m.id}
                  title="Enter score"
                  match={m}
                  actionLabel="Open"
                  onAction={() => navigate(`/community/${m.competition_slug}`)}
                />
              ))}
            </section>
          )
        })()}

        <section className="community-section community-section-friends">
          <div className="section-head">
            <h2>
              Friends
              {incoming.length > 0 ? (
                <span className="count-pill">{incoming.length}</span>
              ) : null}
            </h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFriendsOpen((v) => !v)}
            >
              {friendsOpen ? 'Hide' : 'Add friends'}
            </button>
          </div>

          {incoming.length > 0 && (
            <div className="friend-list" style={{ marginBottom: 16 }}>
              {incoming.map((f) => (
                <FriendRow
                  key={f.id}
                  f={f}
                  actions={[
                    { label: 'Accept', dark: true, onClick: () => acceptMut.mutate(f.id) },
                    { label: 'Decline', onClick: () => removeMut.mutate(f.id) },
                  ]}
                />
              ))}
            </div>
          )}

          {friendsOpen && (
            <div className="community-panel">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="player-search">
                  Search by name
                </label>
                <input
                  id="player-search"
                  className="form-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Type a name"
                  autoFocus
                />
              </div>
              {search.trim().length >= 2 && (
                <div className="friend-list" style={{ marginTop: 12 }}>
                  {(searchQ.data || []).map((p) => (
                    <div key={p.id} className="friend-row">
                      <div className="friend-row-main">
                        <span className="avatar">{initials(p.full_name)}</span>
                        <div>
                          <strong>
                            <Link to={`/players/${p.id}`}>{p.full_name}</Link>
                          </strong>
                          <div className="rank-meta">
                            {p.university_short || '-'} · rating {p.points}
                            {p.friendship_status ? ` · ${friendStatusLabel(p.friendship_status)}` : ''}
                          </div>
                        </div>
                      </div>
                      {!p.friendship_status && (
                        <button
                          type="button"
                          className="btn btn-dark btn-sm"
                          onClick={() => requestMut.mutate(p.id)}
                        >
                          Add
                        </button>
                      )}
                      {p.friendship_status === 'pending_in' && (
                        <button
                          type="button"
                          className="btn btn-dark btn-sm"
                          onClick={() => {
                            const fr = incoming.find((f) => f.user_id === p.id)
                            if (fr) acceptMut.mutate(fr.id)
                          }}
                        >
                          Accept
                        </button>
                      )}
                    </div>
                  ))}
                  {!searchQ.isLoading && (searchQ.data || []).length === 0 && (
                    <p className="muted-note">No one found with that name.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="friend-list" style={{ marginTop: friendsOpen ? 12 : 0 }}>
            {accepted.map((f) => (
              <FriendRow
                key={f.id}
                f={f}
                actions={[{ label: 'Remove', onClick: () => removeMut.mutate(f.id) }]}
              />
            ))}
            {outgoing.map((f) => (
              <FriendRow
                key={f.id}
                f={f}
                actions={[{ label: 'Cancel', onClick: () => removeMut.mutate(f.id) }]}
              />
            ))}
            {accepted.length === 0 && outgoing.length === 0 && incoming.length === 0 && (
              <p className="muted-note">Add friends to invite them into events and filter rankings.</p>
            )}
          </div>
        </section>

        {myUniversity && (
          <section className="community-section">
            <div className="section-head">
              <h2>Your college</h2>
              <Link to="/rankings?scope=university" className="btn btn-ghost btn-sm">
                Rankings
              </Link>
            </div>
            <p className="muted-note" style={{ marginBottom: collegeMates.length ? 12 : 0 }}>
              {myUniversity}
              {collegeMates.length > 0
                ? ` · ${collegeMates.length} friend${collegeMates.length === 1 ? '' : 's'} from your uni`
                : ' · find players from your university on Rankings'}
            </p>
            {collegeMates.length > 0 && (
              <div className="friend-list">
                {collegeMates.slice(0, 8).map((f) => (
                  <FriendRow key={f.id} f={f} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

function sideLabel(m: CommunityMatch, side: 'A' | 'B') {
  if (side === 'A') {
    return m.player_a2_name ? `${m.player_a1_name} / ${m.player_a2_name}` : m.player_a1_name
  }
  return m.player_b2_name ? `${m.player_b1_name} / ${m.player_b2_name}` : m.player_b1_name
}

function ActionCard({
  title,
  match,
  actionLabel,
  onAction,
  disabled,
}: {
  title: string
  match: CommunityMatch
  actionLabel: string
  onAction: () => void
  disabled?: boolean
}) {
  return (
    <div className="action-card">
      <div>
        <div className="action-card-kicker">
          {title}
          {match.court_number ? ` · Court ${match.court_number}` : ''}
        </div>
        <strong>
          {sideLabel(match, 'A')} vs {sideLabel(match, 'B')}
        </strong>
        <div className="rank-meta">{match.competition_name}</div>
      </div>
      <button type="button" className="btn btn-dark btn-sm" onClick={onAction} disabled={disabled}>
        {actionLabel}
      </button>
    </div>
  )
}

function FriendRow({
  f,
  actions,
}: {
  f: Friendship
  actions?: { label: string; dark?: boolean; onClick: () => void }[]
}) {
  return (
    <div className="friend-row">
      <div className="friend-row-main">
        <span className="avatar">{initials(f.full_name)}</span>
        <div>
          <strong>
            <Link to={`/players/${f.user_id}`}>{f.full_name}</Link>
          </strong>
          <div className="rank-meta">
            {f.university_short || '-'} · {f.points}
            {f.direction === 'incoming' ? ' · wants to connect' : ''}
            {f.direction === 'outgoing' ? ' · request sent' : ''}
          </div>
        </div>
      </div>
      {actions && actions.length > 0 && (
        <div className="friend-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`btn btn-sm ${a.dark ? 'btn-dark' : 'btn-ghost'}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function friendStatusLabel(s: string) {
  if (s === 'friends') return 'friends'
  if (s === 'pending_out') return 'pending'
  if (s === 'pending_in') return 'requested you'
  return s
}
