import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Share } from '@capacitor/share'
import BackButton from '../components/BackButton'
import { confirmDialog } from '../components/ConfirmDialog'
import NavBar from '../components/NavBar'
import { ShareQr } from '../components/ShareQr'
import { useAuth } from '../context/AuthContext'
import { useKeyboardInset } from '../hooks/useKeyboardInset'
import { isNativeApp, publicPathUrl } from '../native/platform'
import {
  apiErrorMessage,
  apiErrorStatus,
  communityApi,
  type CommunityMatch,
  type CompetitionMember,
} from '../services/api'
import { statusLabel } from '../utils/format'
import './Tournament.css'
import './Community.css'

const emptySets = {
  set1_a: 0,
  set1_b: 0,
  set2_a: 0,
  set2_b: 0,
  set3_a: 0,
  set3_b: 0,
}

export default function CompetitionDetailPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const scoreMatchId = searchParams.get('score')
  const { user } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [scoreError, setScoreError] = useState('')
  const [showMatch, setShowMatch] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [format, setFormat] = useState('DOUBLES')
  const [court, setCourt] = useState(1)
  const [a1, setA1] = useState('')
  const [a2, setA2] = useState('')
  const [b1, setB1] = useState('')
  const [b2, setB2] = useState('')
  const [scoringMatch, setScoringMatch] = useState<CommunityMatch | null>(null)
  const [winnerSide, setWinnerSide] = useState<'A' | 'B' | ''>('')
  const [lastDeltas, setLastDeltas] = useState<CommunityMatch['rating_changes']>([])
  useKeyboardInset(!!scoringMatch || showMatch)
  const [inviteIds, setInviteIds] = useState<string[]>([])
  const [copied, setCopied] = useState('')
  const [pendingNotice, setPendingNotice] = useState('')

  const compQ = useQuery({
    queryKey: ['competition', slug],
    queryFn: async () => (await communityApi.getCompetition(slug)).data,
    enabled: !!user && !!slug,
  })
  const matchesQ = useQuery({
    queryKey: ['competition-matches', slug],
    queryFn: async () => (await communityApi.matches(slug)).data,
    enabled: !!user && !!slug,
  })

  // Deep-link from Community home: /community/:slug?score=matchId
  useEffect(() => {
    if (!scoreMatchId || scoringMatch) return
    const match = (matchesQ.data || []).find((m) => m.id === scoreMatchId)
    if (!match || !match.can_i_score || match.needs_my_confirm) return
    setWinnerSide('')
    setScoreError('')
    setScoringMatch(match)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('score')
        return next
      },
      { replace: true },
    )
  }, [scoreMatchId, matchesQ.data, scoringMatch, setSearchParams])
  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: !!user,
  })

  const c = compQ.data
  const members = c?.members
  const memberIds = useMemo(
    () => new Set((members || []).map((m) => m.user_id)),
    [members],
  )
  const invitable = useMemo(
    () => (friendsQ.data || []).filter((f) => f.direction === 'friend' && !memberIds.has(f.user_id)),
    [friendsQ.data, memberIds],
  )

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['competition', slug] })
    qc.invalidateQueries({ queryKey: ['competition-matches', slug] })
    qc.invalidateQueries({ queryKey: ['competitions'] })
    qc.invalidateQueries({ queryKey: ['community-home'] })
    qc.invalidateQueries({ queryKey: ['rankings'] })
    qc.invalidateQueries({ queryKey: ['friends'] })
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const createMatchMut = useMutation({
    mutationFn: () =>
      communityApi.createMatch(c!.id, {
        format,
        player_a1_id: a1,
        player_a2_id: format === 'DOUBLES' ? a2 : null,
        player_b1_id: b1,
        player_b2_id: format === 'DOUBLES' ? b2 : null,
        court_number: court,
      }),
    onSuccess: (res) => {
      setError('')
      setShowMatch(false)
      setWinnerSide('')
      setScoringMatch(res.data)
      setPendingNotice('')
      refresh()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const scoreMut = useMutation({
    mutationFn: () =>
      communityApi.scoreMatch(scoringMatch!.id, {
        ...emptySets,
        winner_side: winnerSide,
        status: 'AWAITING_CONFIRM',
      }),
    onSuccess: () => {
      setScoreError('')
      setScoringMatch(null)
      setWinnerSide('')
      setPendingNotice('Result saved. Someone else on court needs to confirm before ratings update.')
      setLastDeltas([])
      refresh()
    },
    onError: (e) => setScoreError(apiErrorMessage(e)),
  })

  const confirmMut = useMutation({
    mutationFn: (matchId: string) => communityApi.confirmMatch(matchId),
    onSuccess: (res) => {
      setError('')
      setPendingNotice('')
      setLastDeltas(res.data.rating_changes || [])
      refresh()
      qc.invalidateQueries({ queryKey: ['rankings'] })
      for (const d of res.data.rating_changes || []) {
        qc.invalidateQueries({ queryKey: ['player', d.user_id] })
      }
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const cancelMatchMut = useMutation({
    mutationFn: (matchId: string) =>
      communityApi.scoreMatch(matchId, { ...emptySets, status: 'CANCELLED' }),
    onSuccess: () => {
      setError('')
      setScoringMatch(null)
      setWinnerSide('')
      setPendingNotice('')
      refresh()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const inviteMut = useMutation({
    mutationFn: () => communityApi.inviteFriends(c!.id, inviteIds),
    onSuccess: () => {
      setError('')
      setInviteIds([])
      refresh()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const leaveMut = useMutation({
    mutationFn: () => communityApi.leaveCompetition(c!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['community-home'] })
      qc.invalidateQueries({ queryKey: ['competitions'] })
      navigate('/community')
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const removeMemberMut = useMutation({
    mutationFn: (userId: string) => communityApi.removeMember(c!.id, userId),
    onSuccess: () => {
      setError('')
      refresh()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const closeMut = useMutation({
    mutationFn: () => communityApi.setStatus(c!.id, 'COMPLETED'),
    onSuccess: () => {
      refresh()
      qc.invalidateQueries({ queryKey: ['community-home'] })
      qc.invalidateQueries({ queryKey: ['competitions'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  // Lock body scroll while score sheet is open (iOS-friendly)
  useEffect(() => {
    document.body.classList.toggle('modal-open', !!scoringMatch)
    return () => document.body.classList.remove('modal-open')
  }, [scoringMatch])

  useEffect(() => {
    if (!scoringMatch) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setScoringMatch(null)
        setScoreError('')
        setWinnerSide('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scoringMatch])

  const copyCode = async () => {
    if (!c?.invite_code) return
    try {
      await navigator.clipboard.writeText(c.invite_code)
      setCopied('code')
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setError('Could not copy invite code')
    }
  }

  const copyLink = async () => {
    if (!c?.invite_code) return
    const url = publicPathUrl(`/join/${c.invite_code}`)
    try {
      if (isNativeApp()) {
        const can = await Share.canShare()
        if (can.value) {
          await Share.share({
            title: c.name,
            text: `Join my friends group on Student Padel Ireland (code ${c.invite_code})`,
            url,
            dialogTitle: 'Invite friends',
          })
          setCopied('link')
          setTimeout(() => setCopied(''), 1500)
          return
        }
      }
      await navigator.clipboard.writeText(url)
      setCopied('link')
      setTimeout(() => setCopied(''), 1500)
    } catch (err: unknown) {
      // User dismissed the share sheet - not an error
      const msg = err instanceof Error ? err.message : String(err)
      if (/cancel|dismiss/i.test(msg)) return
      setError('Could not share / copy link')
    }
  }

  const myOpen = useMemo(() => {
    const list = [...(matchesQ.data || [])]
    return list
      .filter(
        (m) =>
          user &&
          [m.player_a1_id, m.player_a2_id, m.player_b1_id, m.player_b2_id].includes(user.id) &&
          m.status !== 'COMPLETED' &&
          m.status !== 'CANCELLED',
      )
      .reverse()
  }, [matchesQ.data, user])
  const myNext = myOpen[0]

  const pendingConfirms = useMemo(
    () => (matchesQ.data || []).filter((m) => m.status === 'AWAITING_CONFIRM' && !m.ratings_applied),
    [matchesQ.data],
  )

  if (!user) {
    const next = encodeURIComponent(`/community/${slug}`)
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Friends group</h1>
          <p className="page-sub">Sign up or log in to view this earlier friend group.</p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link to={`/signup?next=${next}`} className="btn btn-primary">
              Sign up
            </Link>
            <Link to={`/login?next=${next}`} className="btn btn-ghost">
              Log in
            </Link>
            <Link to="/community" className="btn btn-ghost">
              Back to Friends
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (compQ.isLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 120 }} />
        </main>
      </div>
    )
  }

  if (compQ.isError || !c) {
    const status = apiErrorStatus(compQ.error)
    const notMember = status === 403
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="empty-state">
            <p>
              {notMember
                ? 'You’re not a member of this competition. Ask for an invite code to join.'
                : 'Competition not found.'}
            </p>
            <Link to="/community" className="btn btn-primary" style={{ marginTop: 12 }}>
              Back to Friends
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const defaultFormat = c.format === 'SINGLES' ? 'SINGLES' : 'DOUBLES'
  const selected = new Set([a1, a2, b1, b2].filter(Boolean))
  const canLog = c.status !== 'CANCELLED' && c.status !== 'COMPLETED'
  const courtCount = c.number_of_courts || 2
  const joinUrl = c.invite_code ? publicPathUrl(`/join/${c.invite_code}`) : ''
  const memberList = members || []

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <BackButton fallbackTo="/community" />
        <div className="page-header-row">
          <h1 className="page-title">{c.name}</h1>
          <div className="header-actions">
            {c.invite_code && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowShare((v) => !v)}
              >
                Share
              </button>
            )}
            {canLog && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setFormat(defaultFormat)
                  setShowMatch((v) => !v)
                  setError('')
                  if (user && !a1) setA1(user.id)
                }}
              >
                {showMatch ? 'Close' : 'New game'}
              </button>
            )}
          </div>
        </div>
        <p className="page-sub">
          {labelFormat(c.format)} · {c.member_count} players · {courtCount} courts · {statusLabel(c.status)}
        </p>

        {showShare && c.invite_code && (
          <div className="share-panel">
            <div>
              <h2>Invite friends</h2>
              <p className="muted-note">
                Send the code or QR. Friends tap <strong>Code</strong> under Friends or Tournaments.
              </p>
              <div className="share-code-row">
                <code className="share-code">{c.invite_code}</code>
                <button type="button" className="btn btn-dark btn-sm" onClick={copyCode}>
                  {copied === 'code' ? 'Copied' : 'Copy code'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>
                  {copied === 'link' ? 'Copied' : 'Copy link'}
                </button>
              </div>
            </div>
            <div className="share-qr">
              <ShareQr url={joinUrl} openLabel="Open join page" />
            </div>
          </div>
        )}

        {myNext && (
          <section className="next-game-hero compact">
            <div className="next-game-label">Your next game</div>
            <div className="next-game-court">
              {myNext.court_number ? `Court ${myNext.court_number}` : 'Court TBC'}
            </div>
            <div className="next-game-vs">
              <span>
                {myNext.player_a1_name}
                {myNext.player_a2_name ? ` / ${myNext.player_a2_name}` : ''}
              </span>
              <em>vs</em>
              <span>
                {myNext.player_b1_name}
                {myNext.player_b2_name ? ` / ${myNext.player_b2_name}` : ''}
              </span>
            </div>
            {(myNext.needs_my_confirm || myNext.can_i_score) && (
              <div className="next-game-actions">
                {myNext.needs_my_confirm && (
                  <button
                    type="button"
                    className="btn btn-dark btn-sm"
                    disabled={confirmMut.isPending && confirmMut.variables === myNext.id}
                    onClick={() => confirmMut.mutate(myNext.id)}
                  >
                    {confirmMut.isPending && confirmMut.variables === myNext.id
                      ? 'Confirming…'
                      : 'Confirm result'}
                  </button>
                )}
                {myNext.can_i_score && !myNext.needs_my_confirm && (
                  <button
                    type="button"
                    className="btn btn-dark btn-sm"
                    onClick={() => {
                      setWinnerSide('')
                      setScoreError('')
                      setScoringMatch(myNext)
                    }}
                  >
                    Who won?
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {error && <p className="form-error">{error}</p>}
        {pendingNotice && <p className="form-success">{pendingNotice}</p>}

        {lastDeltas.length > 0 && (
          <div className="rating-flash">
            <strong>Ratings updated</strong>
            <ul>
              {lastDeltas.map((d) => (
                <li key={d.user_id}>
                  {d.full_name}: {d.delta >= 0 ? '+' : ''}
                  {d.delta} → {d.rating_after}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => {
                setLastDeltas([])
                setFormat(defaultFormat)
                setShowMatch(true)
                if (user) setA1(user.id)
              }}
            >
              Play again
            </button>
          </div>
        )}

        {showMatch && canLog && (
          <form
            className="community-panel"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              setError('')
              createMatchMut.mutate()
            }}
          >
            <h2>Who’s playing?</h2>
            {c.format === 'MIXED' && (
              <div className="form-group">
                <label htmlFor="match-format">Format</label>
                <select
                  id="match-format"
                  className="form-select"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="DOUBLES">Doubles (2 vs 2)</option>
                  <option value="SINGLES">Singles (1 vs 1)</option>
                </select>
              </div>
            )}
            <div className="form-group">
              <label htmlFor="match-court">Court</label>
              <select
                id="match-court"
                className="form-select"
                value={court}
                onChange={(e) => setCourt(Number(e.target.value))}
              >
                {Array.from({ length: courtCount }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Court {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="match-sides">
              <SidePick
                label="Your side"
                members={members ?? []}
                p1={a1}
                p2={a2}
                setP1={setA1}
                setP2={setA2}
                doubles={format === 'DOUBLES'}
                taken={selected}
              />
              <SidePick
                label="Opponents"
                members={members ?? []}
                p1={b1}
                p2={b2}
                setP1={setB1}
                setP2={setB2}
                doubles={format === 'DOUBLES'}
                taken={selected}
              />
            </div>
            <button type="submit" className="btn btn-dark" disabled={createMatchMut.isPending}>
              Next: pick winner
            </button>
          </form>
        )}

        <section className="community-section">
          <h2>Standings</h2>
          <ol className="comp-standings">
            {memberList.map((m, i) => (
              <li key={m.user_id}>
                <span className="rank-num">#{i + 1}</span>
                <span>
                  <Link to={`/players/${m.user_id}`}>
                    <strong>{m.full_name}</strong>
                  </Link>
                  <div className="rank-meta">
                    {m.comp_wins}W-{m.comp_losses}L · rating {m.points}
                    {m.role === 'OWNER' ? ' · host' : ''}
                  </div>
                </span>
                <span className="standings-end">
                  <strong className="rank-pts">
                    {m.comp_wins - m.comp_losses >= 0 ? '+' : ''}
                    {m.comp_wins - m.comp_losses}
                  </strong>
                  {c.is_owner && canLog && m.role !== 'OWNER' && m.user_id !== user?.id && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm standings-remove"
                      disabled={removeMemberMut.isPending}
                      onClick={() => {
                        void confirmDialog({
                          title: 'Remove player?',
                          message: `${m.full_name} will leave this competition.`,
                          confirmLabel: 'Remove',
                          danger: true,
                        }).then((ok) => {
                          if (ok) removeMemberMut.mutate(m.user_id)
                        })
                      }}
                    >
                      Remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {invitable.length > 0 && canLog && c.is_owner && (
            <div className="community-panel" style={{ marginTop: '1.5rem' }}>
              <h2>Add friends</h2>
              <div className="friend-chip-row">
                {invitable.map((f) => (
                  <button
                    key={f.user_id}
                    type="button"
                    className={`friend-chip ${inviteIds.includes(f.user_id) ? 'on' : ''}`}
                    onClick={() =>
                      setInviteIds((prev) =>
                        prev.includes(f.user_id)
                          ? prev.filter((x) => x !== f.user_id)
                          : [...prev, f.user_id],
                      )
                    }
                  >
                    <span className="avatar-sm">
                      {f.full_name
                        .split(' ')
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </span>
                    {f.full_name.split(' ')[0]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: 12 }}
                disabled={!inviteIds.length || inviteMut.isPending}
                onClick={() => inviteMut.mutate()}
              >
                Add selected
              </button>
            </div>
          )}
        </section>

        <section className="community-section">
          <h2>Games</h2>
          {(matchesQ.data || []).length === 0 && (
            <p className="muted-note">No games yet. Tap New game.</p>
          )}
          <div className="match-feed">
            {(matchesQ.data || []).map((m) => (
              <article key={m.id} className="match-feed-card">
                <div className="match-court-tag">
                  {m.court_number ? `Court ${m.court_number}` : 'Court TBC'}
                </div>
                <div className="match-feed-teams">
                  <div>
                    <strong>
                      {m.player_a1_name}
                      {m.player_a2_name ? ` / ${m.player_a2_name}` : ''}
                    </strong>
                    {m.winner_side === 'A' && <span className="won-tag"> won</span>}
                  </div>
                  <span className="vs">vs</span>
                  <div>
                    <strong>
                      {m.player_b1_name}
                      {m.player_b2_name ? ` / ${m.player_b2_name}` : ''}
                    </strong>
                    {m.winner_side === 'B' && <span className="won-tag"> won</span>}
                  </div>
                </div>
                <p className="rank-meta">
                  {labelFormat(m.format)} · {statusLabel(m.status)}
                  {m.status === 'COMPLETED' && m.winner_side
                    ? ` · ${m.winner_side === 'A' ? 'Side A' : 'Side B'} won`
                    : ''}
                </p>
                {m.status === 'AWAITING_CONFIRM' && (
                  <p className="rank-meta" style={{ marginTop: 6 }}>
                    Waiting for someone else to confirm
                    {m.winner_side
                      ? ` · ${m.winner_side === 'A' ? 'Side A' : 'Side B'} reported as winner`
                      : ''}
                  </p>
                )}
                <div className="friend-actions" style={{ marginTop: 8 }}>
                  {m.needs_my_confirm && (
                    <button
                      type="button"
                      className="btn btn-dark btn-sm"
                      disabled={confirmMut.isPending && confirmMut.variables === m.id}
                      onClick={() => confirmMut.mutate(m.id)}
                    >
                      {confirmMut.isPending && confirmMut.variables === m.id
                        ? 'Confirming…'
                        : 'Confirm result'}
                    </button>
                  )}
                  {m.can_i_score && !m.needs_my_confirm && (
                    <button
                      type="button"
                      className="btn btn-dark btn-sm"
                      onClick={() => {
                        setWinnerSide('')
                        setScoreError('')
                        setLastDeltas([])
                        setScoringMatch(m)
                      }}
                    >
                      Who won?
                    </button>
                  )}
                  {(m.can_i_score ||
                    (m.status === 'AWAITING_CONFIRM' &&
                      !m.ratings_applied &&
                      (m.recorded_by_id === user?.id || c.is_owner))) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={cancelMatchMut.isPending}
                      onClick={() => {
                        void confirmDialog({
                          title: 'Cancel match?',
                          message: 'This match will be cancelled with no result.',
                          confirmLabel: 'Cancel match',
                          danger: true,
                        }).then((ok) => {
                          if (ok) cancelMatchMut.mutate(m.id)
                        })
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="community-footer-actions">
          {c.is_owner && canLog && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={closeMut.isPending}
              onClick={() => {
                if (pendingConfirms.length > 0) {
                  setError(
                    `Finish or cancel ${pendingConfirms.length} score${pendingConfirms.length === 1 ? '' : 's'} waiting for confirm first.`,
                  )
                  return
                }
                void confirmDialog({
                  title: 'Mark complete?',
                  message: 'You can still view results after closing this competition.',
                  confirmLabel: 'Mark complete',
                }).then((ok) => {
                  if (ok) closeMut.mutate()
                })
              }}
            >
              {closeMut.isPending ? 'Saving…' : 'Mark complete'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={leaveMut.isPending}
            onClick={() => {
              void confirmDialog({
                title: c.is_owner ? 'Leave as host?' : 'Leave competition?',
                message: c.is_owner
                  ? 'Only works if you are the only member.'
                  : 'You will leave this competition.',
                confirmLabel: 'Leave',
                danger: true,
              }).then((ok) => {
                if (ok) leaveMut.mutate()
              })
            }}
          >
            {leaveMut.isPending ? 'Leaving…' : 'Leave'}
          </button>
        </div>

        {scoringMatch && (
          <div
            className="score-modal-backdrop"
            onClick={() => {
              setScoringMatch(null)
              setScoreError('')
              setWinnerSide('')
            }}
          >
            <form
              className="score-modal community-score-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="score-modal-title"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault()
                setScoreError('')
                if (winnerSide !== 'A' && winnerSide !== 'B') {
                  setScoreError('Pick who won the match')
                  return
                }
                scoreMut.mutate()
              }}
            >
              <h2 id="score-modal-title">Who won?</h2>
              <p className="muted-note" style={{ marginTop: 0 }}>
                Tap the winning side. Someone on the other side will confirm before ratings update.
              </p>
              <div className="winner-pick" role="group" aria-label="Match winner">
                <button
                  type="button"
                  className={`winner-pick-btn${winnerSide === 'A' ? ' is-selected' : ''}`}
                  aria-pressed={winnerSide === 'A'}
                  onClick={() => setWinnerSide('A')}
                >
                  <span className="muted-note">Side A</span>
                  <strong>
                    {scoringMatch.player_a1_name}
                    {scoringMatch.player_a2_name ? ` / ${scoringMatch.player_a2_name}` : ''}
                  </strong>
                  <span className="winner-pick-tag">{winnerSide === 'A' ? 'Winner' : 'Tap if they won'}</span>
                </button>
                <button
                  type="button"
                  className={`winner-pick-btn${winnerSide === 'B' ? ' is-selected' : ''}`}
                  aria-pressed={winnerSide === 'B'}
                  onClick={() => setWinnerSide('B')}
                >
                  <span className="muted-note">Side B</span>
                  <strong>
                    {scoringMatch.player_b1_name}
                    {scoringMatch.player_b2_name ? ` / ${scoringMatch.player_b2_name}` : ''}
                  </strong>
                  <span className="winner-pick-tag">{winnerSide === 'B' ? 'Winner' : 'Tap if they won'}</span>
                </button>
              </div>
              {scoreError && <p className="form-error">{scoreError}</p>}
              <div className="tour-actions">
                <button type="submit" className="btn btn-dark" disabled={scoreMut.isPending || !winnerSide}>
                  {scoreMut.isPending ? 'Saving…' : 'Submit for confirm'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setScoringMatch(null)
                    setScoreError('')
                    setWinnerSide('')
                  }}
                >
                  Back
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}

function SidePick({
  label,
  members,
  p1,
  p2,
  setP1,
  setP2,
  doubles,
  taken,
}: {
  label: string
  members: CompetitionMember[]
  p1: string
  p2: string
  setP1: (v: string) => void
  setP2: (v: string) => void
  doubles: boolean
  taken: Set<string>
}) {
  const options = (current: string) =>
    members.filter((m) => m.user_id === current || !taken.has(m.user_id))

  return (
    <fieldset className="side-pick">
      <legend>{label}</legend>
      <div className="form-group">
        <label>Player</label>
        <select className="form-select" value={p1} onChange={(e) => setP1(e.target.value)} required>
          <option value="">Select player</option>
          {options(p1).map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </select>
      </div>
      {doubles && (
        <div className="form-group">
          <label>Partner</label>
          <select className="form-select" value={p2} onChange={(e) => setP2(e.target.value)} required>
            <option value="">Select player</option>
            {options(p2).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </fieldset>
  )
}

function labelFormat(f: string) {
  if (f === 'SINGLES') return 'Singles'
  if (f === 'MIXED') return 'Mixed'
  return 'Doubles'
}
