import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import {
  apiErrorMessage,
  communityApi,
  type CommunityMatch,
  type Friendship,
} from '../services/api'
import './Tournament.css'
import './Community.css'

const FORMATS = [
  {
    id: 'DOUBLES',
    title: 'Doubles',
    blurb: '2 vs 2 — usual padel format',
  },
  {
    id: 'SINGLES',
    title: 'Singles',
    blurb: '1 vs 1',
  },
  {
    id: 'MIXED',
    title: 'Both',
    blurb: 'Singles and doubles in one group',
  },
] as const

export default function CommunityPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [inviteCode, setInviteCode] = useState(() => params.get('code')?.toUpperCase() || '')
  const [createOpen, setCreateOpen] = useState(false)
  const [compName, setCompName] = useState('')
  const [compFormat, setCompFormat] = useState('DOUBLES')
  const [courts, setCourts] = useState(2)
  const [selectedFriends, setSelectedFriends] = useState<string[]>([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [friendsOpen, setFriendsOpen] = useState(false)

  const homeQ = useQuery({
    queryKey: ['community-home'],
    queryFn: async () => (await communityApi.home()).data,
    enabled: !!user,
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
  const comps = homeQ.data?.competitions || []
  const needsConfirm = homeQ.data?.needs_confirm || []
  const needsScore = homeQ.data?.needs_score || []
  const nextMatches = homeQ.data?.my_next_matches || []
  const confirmIds = useMemo(
    () => new Set((homeQ.data?.needs_confirm || []).map((m) => m.id)),
    [homeQ.data?.needs_confirm],
  )
  const nextGame = nextMatches.find((m) => !confirmIds.has(m.id)) || nextMatches[0]

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['community-home'] })
    qc.invalidateQueries({ queryKey: ['friends'] })
    qc.invalidateQueries({ queryKey: ['player-search'] })
    qc.invalidateQueries({ queryKey: ['competitions'] })
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
      refresh()
      navigate(`/community/${res.data.slug}`)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const joinMut = useMutation({
    mutationFn: () => communityApi.joinByCode(inviteCode.trim()),
    onSuccess: (res) => {
      setError('')
      setInviteCode('')
      refresh()
      navigate(`/community/${res.data.slug}`)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const confirmMut = useMutation({
    mutationFn: (id: string) => communityApi.confirmMatch(id),
    onSuccess: () => {
      setError('')
      refresh()
      qc.invalidateQueries({ queryKey: ['rankings'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy')
    }
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <div className="page-header-row">
          <h1 className="page-title">Community</h1>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: 40, padding: '0.4rem 0.9rem' }}
            onClick={() => {
              setCreateOpen((v) => !v)
              setError('')
            }}
          >
            {createOpen ? 'Close' : 'New competition'}
          </button>
        </div>
        <p className="page-sub">Play with friends — share a code, pick a court, confirm the score.</p>

        {error && <p className="form-error">{error}</p>}
        {copied && <p className="form-success">Copied</p>}

        {homeQ.isLoading && (
          <>
            <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 80 }} />
          </>
        )}

        {homeQ.isError && (
          <div className="empty-state">
            <p>Couldn’t load community right now.</p>
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
              <span>
                {sideLabel(nextGame, 'A')}
              </span>
              <em>vs</em>
              <span>
                {sideLabel(nextGame, 'B')}
              </span>
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
                  onClick={() => confirmMut.mutate(nextGame.id)}
                >
                  Confirm score
                </button>
              )}
              <Link to={`/community/${nextGame.competition_slug}`} className="btn btn-ghost btn-sm">
                Open competition
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
                  actionLabel="Confirm"
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

        {createOpen && (
          <form
            className="community-panel"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              setError('')
              createMut.mutate()
            }}
          >
            <h2>Create a competition</h2>
            <p className="muted-note" style={{ marginBottom: 12 }}>
              A private group for you and your friends. Share the code so others can join.
            </p>
            <div className="form-group">
              <label htmlFor="comp-name">Name</label>
              <input
                id="comp-name"
                value={compName}
                onChange={(e) => setCompName(e.target.value)}
                placeholder="Friday padel"
                required
                minLength={3}
              />
            </div>
            <div className="form-group">
              <label>Format</label>
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
              <label htmlFor="comp-courts">Courts available</label>
              <select id="comp-courts" value={courts} onChange={(e) => setCourts(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} court{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </div>
            {accepted.length > 0 && (
              <div className="form-group">
                <label>Invite friends now</label>
                <div className="friend-chip-row">
                  {accepted.map((f) => (
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
                      <span className="avatar-sm">{initials(f.full_name)}</span>
                      {f.full_name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="submit" className="btn btn-dark" disabled={createMut.isPending}>
              Create competition
            </button>
          </form>
        )}

        <section className="community-section">
          <h2>Join with a code</h2>
          <form
            className="join-code-row"
            onSubmit={(e) => {
              e.preventDefault()
              setError('')
              joinMut.mutate()
            }}
          >
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="e.g. EHWDZA78"
              aria-label="Invite code"
              autoComplete="off"
            />
            <button type="submit" className="btn btn-dark" disabled={!inviteCode.trim() || joinMut.isPending}>
              Join
            </button>
          </form>
          <p className="muted-note">Or scan a friend’s QR code — it opens this page with the code filled in.</p>
        </section>

        <section className="community-section">
          <h2>Your competitions</h2>
          {comps.length === 0 && !homeQ.isLoading && (
            <p className="muted-note">None yet — create one or join with a code.</p>
          )}
          <div className="tour-list">
            {comps.map((c) => (
              <Link key={c.id} to={`/community/${c.slug}`} className="tour-card-link">
                <article className="tour-card">
                  <div className="tour-card-top">
                    <h2>{c.name}</h2>
                    <span className="badge badge-draft">{labelFormat(c.format)}</span>
                  </div>
                  <p>
                    {c.member_count} players · {c.number_of_courts || 2} courts · {labelStatus(c.status)}
                  </p>
                  <p className="tour-card-meta">
                    Host {c.created_by_name}
                    {c.invite_code ? (
                      <>
                        {' '}
                        · code{' '}
                        <button
                          type="button"
                          className="code-inline"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            copyCode(c.invite_code)
                          }}
                        >
                          {c.invite_code}
                        </button>
                      </>
                    ) : null}
                  </p>
                </article>
              </Link>
            ))}
          </div>
        </section>

        <section className="community-section">
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
                <label htmlFor="player-search">Search by name</label>
                <input
                  id="player-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Type a name…"
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
                            {p.university_short || '—'} · rating {p.points}
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
              <p className="muted-note">Add friends so you can invite them into competitions.</p>
            )}
          </div>
        </section>
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
}: {
  title: string
  match: CommunityMatch
  actionLabel: string
  onAction: () => void
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
      <button type="button" className="btn btn-dark btn-sm" onClick={onAction}>
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
            {f.university_short || '—'} · {f.points}
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

function labelFormat(f: string) {
  if (f === 'SINGLES') return 'Singles'
  if (f === 'MIXED') return 'Mixed'
  return 'Doubles'
}

function labelStatus(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase()
}

function friendStatusLabel(s: string) {
  if (s === 'friends') return 'friends'
  if (s === 'pending_out') return 'pending'
  if (s === 'pending_in') return 'requested you'
  return s
}
