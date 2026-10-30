import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { HaveCodeButton } from '../components/JoinCodeModal'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import {
  apiErrorMessage,
  communityApi,
  platformApi,
  type Competition,
  type Friendship,
} from '../services/api'
import { looksLikeInviteCode, cleanInviteCode } from '../utils/inviteCode'
import './Tournament.css'
import './Community.css'

export default function CommunityPage() {
  usePageSeo({
    title: 'Friends on Student Padel Ireland',
    description:
      'Add friends and join tournaments with a code on Student Padel Ireland.',
    path: '/community',
  })
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [params, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [friendsAutoOpened, setFriendsAutoOpened] = useState(false)
  const [query, setQuery] = useState('')

  const openJoin = params.get('join') === '1'
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

  // Legacy open-play create links → tournament create
  useEffect(() => {
    if (params.get('create') !== '1') return
    navigate('/tournaments?create=1', { replace: true })
  }, [params, navigate])

  const compsQ = useQuery({
    queryKey: ['competitions'],
    queryFn: async () => (await communityApi.competitions()).data,
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
    const list = [...(compsQ.data || [])]
    const rank = (status: string) => {
      if (status === 'LIVE') return 0
      if (status === 'OPEN') return 1
      if (status === 'COMPLETED' || status === 'CANCELLED') return 3
      return 2
    }
    return list.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name))
  }, [compsQ.data])

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
    qc.invalidateQueries({ queryKey: ['competitions'] })
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
          <div className="page-header-row page-header-row--inline">
            <h1 className="page-title">Friends</h1>
            <HaveCodeButton
              className="btn btn-ghost btn-sm"
              autoOpen={openJoin}
              onAutoOpened={clearJoinParam}
            >
              Code
            </HaveCodeButton>
          </div>
          <p className="page-sub page-sub-tight">Add friends and join tournaments with a code</p>

          <ol className="community-guest-steps">
            <li>
              <strong>Add friends</strong>
              <span>Find teammates and see them on rankings.</span>
            </li>
            <li>
              <strong>Join with a code</strong>
              <span>Tap Code to paste a tournament invite.</span>
            </li>
            <li>
              <strong>Create a tournament</strong>
              <span>Run your own event from the Tournaments tab.</span>
            </li>
          </ol>
          <div className="community-guest-actions">
            <Link to={`/signup?next=${next}`} className="btn btn-primary">
              Sign up
            </Link>
            <Link to={`/login?next=${next}`} className="btn btn-ghost">
              Log in
            </Link>
            <Link to="/tournaments?create=1" className="btn btn-ghost">
              New tournament
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <div className="page-header-row page-header-row--inline">
          <h1 className="page-title">Friends</h1>
          <div className="header-actions header-actions--tour">
            <HaveCodeButton
              className="btn btn-ghost btn-sm"
              autoOpen={openJoin}
              onAutoOpened={clearJoinParam}
              initialCode={codeFromSearch}
            >
              Code
            </HaveCodeButton>
          </div>
        </div>
        <p className="page-sub page-sub-tight">Add friends and join tournaments with a code</p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {codeFromSearch && (
          <div className="play-empty" style={{ marginBottom: 16 }}>
            <p>That looks like an invite code — join it below.</p>
            <HaveCodeButton className="btn btn-primary btn-sm" initialCode={codeFromSearch}>
              Join with this code
            </HaveCodeButton>
          </div>
        )}

        {friendsQ.isLoading && (
          <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
        )}

        {friendsQ.isError && (
          <div className="empty-state" style={{ marginBottom: 16 }}>
            <p>Could not load friends right now.</p>
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
              <p className="muted-note">Add friends to invite them to tournaments and filter rankings.</p>
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

        {compsQ.isLoading && (
          <div className="skeleton" style={{ height: 80, marginTop: 8 }} />
        )}

        {compsQ.isError && (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <p>Could not load earlier groups.</p>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 12 }}
              onClick={() => void compsQ.refetch()}
            >
              Retry
            </button>
          </div>
        )}

        {!compsQ.isLoading && !compsQ.isError && competitions.length > 0 && (
          <section className="community-section">
            <div className="section-head">
              <h2>Earlier groups</h2>
            </div>
            <p className="muted-note" style={{ marginBottom: 12 }}>
              New events use tournaments. These older friend groups still work if you need them.
            </p>

            {competitions.length > 2 && (
              <input
                className="form-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search groups"
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
                <p>{query.trim() ? 'No groups match that search.' : 'No groups to show.'}</p>
                {query.trim() && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                )}
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

