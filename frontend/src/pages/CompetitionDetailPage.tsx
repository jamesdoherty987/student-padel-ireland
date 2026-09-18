import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import {
  apiErrorMessage,
  communityApi,
  type CommunityMatch,
  type CompetitionMember,
} from '../services/api'
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
  const [sets, setSets] = useState(emptySets)
  const [lastDeltas, setLastDeltas] = useState<CommunityMatch['rating_changes']>([])
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
      setSets(emptySets)
      setScoringMatch(res.data)
      setPendingNotice('')
      refresh()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const scoreMut = useMutation({
    mutationFn: () =>
      communityApi.scoreMatch(scoringMatch!.id, {
        ...sets,
        status: 'AWAITING_CONFIRM',
      }),
    onSuccess: () => {
      setScoreError('')
      setScoringMatch(null)
      setPendingNotice('Score saved — waiting for someone else on court to confirm before ratings update.')
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
      navigate('/community')
      qc.invalidateQueries({ queryKey: ['competitions'] })
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
    onSuccess: () => refresh(),
    onError: (e) => setError(apiErrorMessage(e)),
  })

  // Lock body scroll while score sheet is open (iOS-friendly)
  useEffect(() => {
    document.body.classList.toggle('modal-open', !!scoringMatch)
    return () => document.body.classList.remove('modal-open')
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
    const url = `${window.location.origin}/community/join/${c.invite_code}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied('link')
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setError('Could not copy link')
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
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="empty-state">
            <p>Competition not found or you are not a member.</p>
            <Link to="/community" className="btn btn-ghost" style={{ marginTop: 12 }}>
              Back to community
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
  const joinUrl = c.invite_code
    ? `${window.location.origin}/community/join/${c.invite_code}`
    : ''
  const memberList = members || []

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page">
        <p className="breadcrumb">
          <Link to="/community">Community</Link> / {c.name}
        </p>
        <div className="page-header-row">
          <h1 className="page-title">{c.name}</h1>
          <div className="header-actions">
            {c.invite_code && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ minHeight: 40, padding: '0.4rem 0.9rem' }}
                onClick={() => setShowShare((v) => !v)}
              >
                Share
              </button>
            )}
            {canLog && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ minHeight: 40, padding: '0.4rem 0.9rem' }}
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
          {labelFormat(c.format)} · {c.member_count} players · {courtCount} courts · {labelStatus(c.status)}
        </p>

        {showShare && c.invite_code && (
          <div className="share-panel">
            <div>
              <h2>Invite friends</h2>
              <p className="muted-note">Send the code, link, or show the QR at the courts.</p>
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
              <QRCodeSVG value={joinUrl} size={140} bgColor="#ffffff" fgColor="#0b3d2e" />
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
            {myNext.needs_my_confirm && (
              <button
                type="button"
                className="btn btn-dark btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => confirmMut.mutate(myNext.id)}
              >
                Confirm score
              </button>
            )}
            {myNext.can_i_score && (
              <button
                type="button"
                className="btn btn-dark btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => {
                  setSets(emptySets)
                  setScoringMatch(myNext)
                }}
              >
                Enter score
              </button>
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
                <select id="match-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="DOUBLES">Doubles (2 vs 2)</option>
                  <option value="SINGLES">Singles (1 vs 1)</option>
                </select>
              </div>
            )}
            <div className="form-group">
              <label htmlFor="match-court">Court</label>
              <select id="match-court" value={court} onChange={(e) => setCourt(Number(e.target.value))}>
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
              Next: enter score
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
                    {m.comp_wins}W–{m.comp_losses}L · rating {m.points}
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
                      onClick={() => {
                        if (window.confirm(`Remove ${m.full_name} from this competition?`)) {
                          removeMemberMut.mutate(m.user_id)
                        }
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
            <div className="community-panel" style={{ marginTop: 16 }}>
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
            <p className="muted-note">No games yet — tap New game.</p>
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
                  {labelFormat(m.format)} · {labelStatus(m.status)}
                  {m.status === 'COMPLETED'
                    ? ` · ${m.set1_a}–${m.set1_b}, ${m.set2_a}–${m.set2_b}${
                        m.set3_a || m.set3_b ? `, ${m.set3_a}–${m.set3_b}` : ''
                      }`
                    : ''}
                </p>
                {m.status === 'AWAITING_CONFIRM' && (
                  <p className="rank-meta" style={{ marginTop: 6 }}>
                    Waiting for someone else to confirm
                    {m.set1_a || m.set1_b
                      ? ` · ${m.set1_a}–${m.set1_b}, ${m.set2_a}–${m.set2_b}`
                      : ''}
                  </p>
                )}
                <div className="friend-actions" style={{ marginTop: 8 }}>
                  {m.needs_my_confirm && (
                    <button
                      type="button"
                      className="btn btn-dark btn-sm"
                      onClick={() => confirmMut.mutate(m.id)}
                    >
                      Confirm score
                    </button>
                  )}
                  {m.can_i_score && (
                    <button
                      type="button"
                      className="btn btn-dark btn-sm"
                      onClick={() => {
                        setSets(emptySets)
                        setLastDeltas([])
                        setScoringMatch(m)
                      }}
                    >
                      Enter score
                    </button>
                  )}
                  {(m.can_i_score ||
                    (m.status === 'AWAITING_CONFIRM' &&
                      !m.ratings_applied &&
                      (m.recorded_by_id === user?.id || c.is_owner))) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => cancelMatchMut.mutate(m.id)}
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
              onClick={() => {
                if (pendingConfirms.length > 0) {
                  setError(
                    `Finish or cancel ${pendingConfirms.length} score${pendingConfirms.length === 1 ? '' : 's'} waiting for confirm first.`,
                  )
                  return
                }
                if (window.confirm('Mark this competition complete? You can still view results.')) {
                  closeMut.mutate()
                }
              }}
            >
              Mark complete
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (window.confirm(c.is_owner ? 'Leave as host? Only works if you are the only member.' : 'Leave this competition?')) {
                leaveMut.mutate()
              }
            }}
          >
            Leave
          </button>
        </div>

        {scoringMatch && (
          <div
            className="score-modal-backdrop"
            onClick={() => {
              setScoringMatch(null)
              setScoreError('')
            }}
          >
            <form
              className="score-modal"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault()
                setScoreError('')
                const pairs: [number, number][] = [
                  [sets.set1_a, sets.set1_b],
                  [sets.set2_a, sets.set2_b],
                  [sets.set3_a, sets.set3_b],
                ]
                let aSets = 0
                let bSets = 0
                for (const [a, b] of pairs) {
                  if (!(a || b)) continue
                  if (a > b) aSets += 1
                  else if (b > a) bSets += 1
                }
                if (aSets === bSets) {
                  setScoreError('Enter decisive set scores so there is a winner')
                  return
                }
                scoreMut.mutate()
              }}
            >
              <h2>Enter score</h2>
              <div className="score-sides-label">
                <div>
                  <span className="muted-note">Side A</span>
                  <strong>
                    {scoringMatch.player_a1_name}
                    {scoringMatch.player_a2_name ? ` / ${scoringMatch.player_a2_name}` : ''}
                  </strong>
                </div>
                <div>
                  <span className="muted-note">Side B</span>
                  <strong>
                    {scoringMatch.player_b1_name}
                    {scoringMatch.player_b2_name ? ` / ${scoringMatch.player_b2_name}` : ''}
                  </strong>
                </div>
              </div>
              <div className="score-grid">
                {(
                  [
                    ['set1_a', 'set1_b', 'Set 1'],
                    ['set2_a', 'set2_b', 'Set 2'],
                    ['set3_a', 'set3_b', 'Set 3 (if needed)'],
                  ] as const
                ).map(([ka, kb, label]) => (
                  <div key={label} className="form-group">
                    <label>{label}</label>
                    <div className="score-pair">
                      <input
                        type="number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={0}
                        max={7}
                        value={sets[ka]}
                        onChange={(e) => setSets((s) => ({ ...s, [ka]: Number(e.target.value) }))}
                        aria-label={`${label} side A`}
                      />
                      <span>–</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={0}
                        max={7}
                        value={sets[kb]}
                        onChange={(e) => setSets((s) => ({ ...s, [kb]: Number(e.target.value) }))}
                        aria-label={`${label} side B`}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {scoreError && <p className="form-error">{scoreError}</p>}
              <div className="tour-actions">
                <button type="submit" className="btn btn-dark" disabled={scoreMut.isPending}>
                  Submit for confirm
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setScoringMatch(null)
                    setScoreError('')
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
        <select value={p1} onChange={(e) => setP1(e.target.value)} required>
          <option value="">Select…</option>
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
          <select value={p2} onChange={(e) => setP2(e.target.value)} required>
            <option value="">Select…</option>
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

function labelStatus(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase()
}
