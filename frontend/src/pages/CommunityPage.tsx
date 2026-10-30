import { useEffect, useMemo, useRef, useState, useCallback, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { HaveCodeButton } from '../components/JoinCodeModal'
import { useAuth } from '../context/AuthContext'
import { useKeyboardInset } from '../hooks/useKeyboardInset'
import { usePageSeo } from '../hooks/usePageSeo'
import {
  apiErrorMessage,
  communityApi,
  platformApi,
  type Competition,
  type CommunityMatch,
  type Friendship,
} from '../services/api'
import { looksLikeInviteCode, cleanInviteCode } from '../utils/inviteCode'
import './Tournament.css'
import './Community.css'

const FORMATS = [
  { id: 'DOUBLES', title: 'Doubles', blurb: '2 vs 2' },
  { id: 'SINGLES', title: 'Singles', blurb: '1 vs 1' },
  { id: 'MIXED', title: 'Both', blurb: 'Singles and doubles' },
] as const

export default function CommunityPage() {
  usePageSeo({
    title: 'Play Padel with Friends',
    description:
      'Set up open play with friends, join private ladders, log matches, and climb rankings together on Student Padel Ireland.',
    path: '/community',
  })
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [params, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const createFormRef = useRef<HTMLFormElement>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [friendsAutoOpened, setFriendsAutoOpened] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [compName, setCompName] = useState('')
  const [compFormat, setCompFormat] = useState('DOUBLES')
  const [courts, setCourts] = useState(2)
  const [selectedFriends, setSelectedFriends] = useState<string[]>([])
  const [query, setQuery] = useState('')
  useKeyboardInset(createOpen)

  const openJoin = params.get('join') === '1'
  const openCreate = params.get('create') === '1'
  const codeFromSearch = looksLikeInviteCode(query) ? cleanInviteCode(query) : ''

  const clearParam = useCallback(
    (key: string) => {
      if (!params.get(key)) return
      const next = new URLSearchParams(params)
      next.delete(key)
      setSearchParams(next, { replace: true })
    },
    [params, setSearchParams],
  )

  const clearJoinParam = useCallback(() => clearParam('join'), [clearParam])

  const openCreateForm = useCallback(() => {
    setCreateOpen(true)
    setError('')
  }, [])

  useEffect(() => {
    if (!openCreate) return
    if (!user) {
      navigate('/login?next=%2Fcommunity%3Fcreate%3D1', { replace: true })
      return
    }
    setCreateOpen(true)
    clearParam('create')
  }, [openCreate, user, clearParam, navigate])

  useEffect(() => {
    if (!createOpen) return
    createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [createOpen])

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
  const competitions = useMemo(() => {
    const list = [...(homeQ.data?.competitions || [])]
    const rank = (status: string) => {
      if (status === 'LIVE') return 0
      if (status === 'OPEN') return 1
      if (status === 'COMPLETED' || status === 'CANCELLED') return 3
      return 2
    }
    return list.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name))
  }, [homeQ.data?.competitions])
  const needsConfirm = homeQ.data?.needs_confirm || []
  const needsScore = homeQ.data?.needs_score || []
  const nextMatches = homeQ.data?.my_next_matches || []
  const confirmIds = useMemo(
    () => new Set((homeQ.data?.needs_confirm || []).map((m) => m.id)),
    [homeQ.data?.needs_confirm],
  )
  const nextGame = nextMatches.find((m) => !confirmIds.has(m.id)) || nextMatches[0]

  const filteredComps = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (looksLikeInviteCode(query)) return []
    if (!q) return competitions
    return competitions.filter((c) =>
      `${c.name} ${c.created_by_name} ${c.invite_code || ''}`.toLowerCase().includes(q),
    )
  }, [competitions, query])

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
    const next = encodeURIComponent(openCreate ? '/community?create=1' : '/community')
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="page-header-row page-header-row--inline">
            <h1 className="page-title">Play</h1>
            <HaveCodeButton
              className="btn btn-ghost btn-sm"
              autoOpen={openJoin}
              onAutoOpened={clearJoinParam}
            >
              Code
            </HaveCodeButton>
          </div>
          <p className="page-sub page-sub-tight">Casual games with friends</p>

          <ol className="community-guest-steps">
            <li>
              <strong>Create a group</strong>
              <span>Invite friends and log games as you play.</span>
            </li>
            <li>
              <strong>Or join with a code</strong>
              <span>Paste an invite above — works for friend groups and tournaments.</span>
            </li>
            <li>
              <strong>Confirm results</strong>
              <span>Both sides confirm before ratings update.</span>
            </li>
          </ol>
          <div className="community-guest-actions">
            <Link to={`/signup?next=${next}`} className="btn btn-primary">
              Sign up to play
            </Link>
            <Link to={`/login?next=${next}`} className="btn btn-ghost">
              Log in
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const confirmCards = needsConfirm.filter((m) => m.id !== nextGame?.id)
  const scoreCards = needsScore.filter((m) => m.id !== nextGame?.id)
  const showNeedsYou = confirmCards.length > 0 || scoreCards.length > 0

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <div className="page-header-row page-header-row--inline">
          <h1 className="page-title">Play</h1>
          <div className="header-actions header-actions--tour">
            <HaveCodeButton
              className="btn btn-ghost btn-sm"
              autoOpen={openJoin}
              onAutoOpened={clearJoinParam}
              initialCode={codeFromSearch}
            >
              Code
            </HaveCodeButton>
            {!createOpen && (
              <button type="button" className="btn btn-primary btn-sm btn-new-tour" onClick={openCreateForm}>
                <i className="fas fa-plus" aria-hidden />
                New
              </button>
            )}
          </div>
        </div>
        <p className="page-sub page-sub-tight">Open play with friends</p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {createOpen && (
          <form
            ref={createFormRef}
            className="community-panel"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              setError('')
              createMut.mutate()
            }}
          >
            <h2>New open-play group</h2>
            <p className="muted-note" style={{ marginBottom: 12 }}>
              For a full bracket with groups, knockout, and paid entry,{' '}
              <Link to="/tournaments?create=1">run a private tournament</Link>.
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
                autoFocus
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
            {accepted.length > 0 && (
              <div className="form-group">
                <label className="form-label">Invite friends now</label>
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
                      {f.full_name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="header-actions">
              <button type="submit" className="btn btn-primary" disabled={createMut.isPending}>
                {createMut.isPending ? 'Creating…' : 'Create group'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCreateOpen(false)
                  setError('')
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {homeQ.isLoading && (
          <>
            <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 80 }} />
          </>
        )}

        {homeQ.isError && (
          <div className="empty-state">
            <p>Could not load your games right now.</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => void homeQ.refetch()}
            >
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
                  disabled={confirmMut.isPending && confirmMut.variables === nextGame.id}
                  onClick={() => confirmMut.mutate(nextGame.id)}
                >
                  {confirmMut.isPending && confirmMut.variables === nextGame.id
                    ? 'Confirming…'
                    : 'Confirm result'}
                </button>
              )}
              {nextGame.can_i_score && !nextGame.needs_my_confirm && (
                <Link
                  to={`/community/${nextGame.competition_slug}?score=${nextGame.id}`}
                  className="btn btn-dark btn-sm"
                >
                  Who won?
                </Link>
              )}
              <Link to={`/community/${nextGame.competition_slug}`} className="btn btn-ghost btn-sm">
                Open group
              </Link>
            </div>
          </section>
        )}

        {showNeedsYou && (
          <section className="up-next">
            <h2>Needs you</h2>
            {confirmCards.map((m) => (
              <ActionCard
                key={m.id}
                title="Confirm result"
                match={m}
                actionLabel={
                  confirmMut.isPending && confirmMut.variables === m.id ? 'Confirming…' : 'Confirm result'
                }
                disabled={confirmMut.isPending && confirmMut.variables === m.id}
                onAction={() => confirmMut.mutate(m.id)}
              />
            ))}
            {scoreCards.map((m) => (
              <ActionCard
                key={m.id}
                title="Who won?"
                match={m}
                actionLabel="Pick winner"
                onAction={() => navigate(`/community/${m.competition_slug}?score=${m.id}`)}
              />
            ))}
          </section>
        )}

        {!homeQ.isLoading && !homeQ.isError && (
          <section className="community-section">
            <div className="section-head">
              <h2>Your groups</h2>
              {!createOpen && competitions.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={openCreateForm}>
                  New
                </button>
              )}
            </div>

            {competitions.length > 2 && (
              <input
                className="form-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your groups"
                aria-label="Search groups"
                style={{ marginBottom: 12 }}
              />
            )}

            {filteredComps.length > 0 ? (
              <div className="tour-list">
                {filteredComps.map((c) => (
                  <CompCard key={c.id} c={c} />
                ))}
              </div>
            ) : (
              <div className="play-empty">
                <p>
                  {codeFromSearch
                    ? 'That looks like an invite code — join it below.'
                    : query.trim()
                      ? 'No groups match that search.'
                      : createOpen
                        ? 'Fill in the form above to create your first group.'
                        : 'No groups yet. Start one for your friends, or join with a code.'}
                </p>
                {codeFromSearch ? (
                  <HaveCodeButton className="btn btn-primary btn-sm" initialCode={codeFromSearch}>
                    Join with this code
                  </HaveCodeButton>
                ) : (
                  !createOpen &&
                  !query.trim() && (
                    <div className="header-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={openCreateForm}>
                        New group
                      </button>
                      <HaveCodeButton className="btn btn-ghost btn-sm">Have a code?</HaveCodeButton>
                    </div>
                  )
                )}
                {query.trim() && !codeFromSearch && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        <section className="community-section community-section-friends">
          <div className="section-head">
            <h2>
              Friends
              {incoming.length > 0 ? <span className="count-pill">{incoming.length}</span> : null}
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
                    {
                      label:
                        acceptMut.isPending && acceptMut.variables === f.id ? 'Accepting…' : 'Accept',
                      dark: true,
                      disabled: acceptMut.isPending || removeMut.isPending,
                      onClick: () => acceptMut.mutate(f.id),
                    },
                    {
                      label:
                        removeMut.isPending && removeMut.variables === f.id ? 'Declining…' : 'Decline',
                      disabled: acceptMut.isPending || removeMut.isPending,
                      onClick: () => removeMut.mutate(f.id),
                    },
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
                          disabled={requestMut.isPending && requestMut.variables === p.id}
                          onClick={() => requestMut.mutate(p.id)}
                        >
                          {requestMut.isPending && requestMut.variables === p.id ? 'Sending…' : 'Add'}
                        </button>
                      )}
                      {p.friendship_status === 'pending_in' && (
                        <button
                          type="button"
                          className="btn btn-dark btn-sm"
                          disabled={acceptMut.isPending}
                          onClick={() => {
                            const fr = incoming.find((f) => f.user_id === p.id)
                            if (fr) acceptMut.mutate(fr.id)
                          }}
                        >
                          {acceptMut.isPending ? 'Accepting…' : 'Accept'}
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
                actions={[
                  {
                    label: removeMut.isPending && removeMut.variables === f.id ? 'Removing…' : 'Remove',
                    disabled: removeMut.isPending && removeMut.variables === f.id,
                    onClick: () => removeMut.mutate(f.id),
                  },
                ]}
              />
            ))}
            {outgoing.map((f) => (
              <FriendRow
                key={f.id}
                f={f}
                actions={[
                  {
                    label: removeMut.isPending && removeMut.variables === f.id ? 'Cancelling…' : 'Cancel',
                    disabled: removeMut.isPending && removeMut.variables === f.id,
                    onClick: () => removeMut.mutate(f.id),
                  },
                ]}
              />
            ))}
            {accepted.length === 0 && outgoing.length === 0 && incoming.length === 0 && (
              <p className="muted-note">Add friends to invite them into groups and filter rankings.</p>
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

function CompCard({ c }: { c: Competition }) {
  return (
    <Link to={`/community/${c.slug}`} className="tour-card-link">
      <article className="tour-card tour-card--simple community-card">
        <h2>{c.name}</h2>
        <p className="tour-card-kind">
          <span>Personal</span>
          <span aria-hidden> · </span>
          <span>{labelCompStatus(c.status)}</span>
        </p>
        <p className="tour-card-line">
          {c.member_count} players · {c.number_of_courts || 2} courts · {labelFormat(c.format)}
        </p>
        <p className="tour-card-meta">
          Host {c.created_by_name}
          {c.invite_code ? ` · code ${c.invite_code}` : ''}
        </p>
      </article>
    </Link>
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
  actions?: { label: string; dark?: boolean; disabled?: boolean; onClick: () => void }[]
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
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              className={`btn btn-sm ${a.dark ? 'btn-dark' : 'btn-ghost'}`}
              disabled={a.disabled}
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
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function friendStatusLabel(s: string) {
  if (s === 'friends') return 'friends'
  if (s === 'pending_out') return 'pending'
  if (s === 'pending_in') return 'requested you'
  return s
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

