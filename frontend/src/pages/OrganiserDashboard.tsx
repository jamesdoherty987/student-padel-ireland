import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { ShareQr } from '../components/ShareQr'
import { useAuth } from '../context/AuthContext'
import { publicPathUrl } from '../native/platform'
import {
  apiErrorMessage,
  communityApi,
  platformApi,
  tournamentApi,
  type Match,
  type PlayerSearch,
} from '../services/api'
import { formatMoney, courtLabel, formatTime } from '../utils/format'
import './Organiser.css'

export default function OrganiserDashboard() {
  const { user, loading: authLoading } = useAuth()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const canOrganise = !!user && (user.role === 'ORGANISER' || user.role === 'ADMIN')
  const { data, isLoading } = useQuery({
    queryKey: ['organiser-dashboard'],
    queryFn: async () => (await platformApi.organiserDashboard()).data,
    enabled: canOrganise,
  })

  const [toast, setToast] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(params.get('t'))
  const [showCreate, setShowCreate] = useState(false)
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [announce, setAnnounce] = useState({ title: '', body: '' })
  const [scoreMatch, setScoreMatch] = useState<Match | null>(null)
  const [scoreForm, setScoreForm] = useState({
    set1_a: 0,
    set1_b: 0,
    set2_a: 0,
    set2_b: 0,
    set3_a: 0,
    set3_b: 0,
    current_set: 1,
    status: 'LIVE',
    winner_id: '',
  })

  useEffect(() => {
    const open = showCreate || confirmGenerate || !!scoreMatch || showAddTeam
    document.body.classList.toggle('modal-open', open)
    return () => document.body.classList.remove('modal-open')
  }, [showCreate, confirmGenerate, scoreMatch, showAddTeam])

  useEffect(() => {
    if (!confirmGenerate && !scoreMatch && !showAddTeam) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setConfirmGenerate(false)
      setScoreMatch(null)
      setShowAddTeam(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmGenerate, scoreMatch, showAddTeam])

  const tournaments = (data?.tournaments || []) as Array<{
    tournament: {
      id: string
      name: string
      slug: string
      status: string
      max_teams: number
      play_format?: string
    }
    teams: number
    players: number
    revenue_cents: number
    paid_registrations: number
    live_matches: number
    completed_matches: number
    checked_in: number
  }>

  const active = tournaments.find((t) => t.tournament.id === selectedId) || tournaments[0]
  const tid = active?.tournament.id
  const slug = active?.tournament.slug

  const { data: teams = [] } = useQuery({
    queryKey: ['org-teams', tid],
    queryFn: async () => (await tournamentApi.teams(tid!)).data,
    enabled: !!tid && canOrganise,
  })

  const { data: matches = [] } = useQuery({
    queryKey: ['org-matches', slug],
    queryFn: async () => (await tournamentApi.matches(slug!)).data,
    enabled: !!slug && canOrganise,
    refetchInterval: 10000,
  })

  const { data: tournamentDetail } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: async () => (await tournamentApi.get(slug!)).data,
    enabled: !!slug && canOrganise,
  })

  const isSingles = (tournamentDetail?.play_format || active?.tournament.play_format) === 'SINGLES'

  const { data: friends = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: canOrganise,
  })

  const friendOptions = useMemo(
    () => friends.filter((f) => f.direction === 'friend'),
    [friends],
  )

  const inviteCode = tournamentDetail?.invite_code || ''
  const joinUrl = inviteCode ? publicPathUrl(`/join/${inviteCode}`) : ''

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3200)
  }

  const generateMut = useMutation({
    mutationFn: () => tournamentApi.generate(tid!),
    onSuccess: (res) => {
      setConfirmGenerate(false)
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      const d = res.data as { matches?: number; groups?: number }
      showToast(`Generated ${d.groups ?? '?'} groups · ${d.matches ?? '?'} matches`)
    },
    onError: (e: unknown) => {
      showToast(apiErrorMessage(e, 'Generate failed. You need at least 2 paid teams.'))
    },
  })

  const seedKoMut = useMutation({
    mutationFn: () => tournamentApi.seedKnockout(tid!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      const d = res.data as { filled?: number }
      showToast(`Knockout seeded · ${d.filled ?? 0} slots filled`)
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not seed knockout')),
  })

  const openMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'REGISTRATION_OPEN' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      showToast('Registration opened')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not open registration')),
  })

  const closeRegMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'REGISTRATION_CLOSED' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      showToast('Registration closed')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not close registration')),
  })

  const goLiveMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'LIVE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      showToast('Tournament is now LIVE')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not go live')),
  })

  const announceMut = useMutation({
    mutationFn: () => tournamentApi.createAnnouncement(tid!, announce),
    onSuccess: () => {
      setAnnounce({ title: '', body: '' })
      showToast('Announcement posted')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not post announcement')),
  })

  const scoreMut = useMutation({
    mutationFn: () =>
      tournamentApi.updateScore(scoreMatch!.id, {
        ...scoreForm,
        winner_id: scoreForm.winner_id || null,
      }),
    onSuccess: () => {
      setScoreMatch(null)
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      qc.invalidateQueries({ queryKey: ['rankings'] })
      qc.invalidateQueries({ queryKey: ['player-view'] })
      showToast('Score saved')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not save score')),
  })

  const checkInMut = useMutation({
    mutationFn: (teamId: string) =>
      tournamentApi.checkIn(tid!, teamId, { player1_present: true, player2_present: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-teams'] })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      showToast(isSingles ? 'Player checked in' : 'Team checked in')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Check-in failed')),
  })

  const copyInviteCode = async () => {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 1600)
    } catch {
      window.prompt('Copy this code', inviteCode)
    }
  }

  const canAddTeams =
    !!active &&
    active.tournament.status !== 'COMPLETED' &&
    active.tournament.status !== 'CANCELLED'

  if (authLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '40%' }} />
        </main>
      </div>
    )
  }

  if (!canOrganise) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Organiser access</h1>
          <p className="page-sub">Sign up as a tournament organiser to manage events.</p>
          <Link to="/signup?role=ORGANISER" className="btn btn-primary">
            Become an organiser
          </Link>
        </main>
      </div>
    )
  }

  return (
    <div className="org-layout">
      <NavBar />
      {toast && <div className="org-toast">{toast}</div>}
      <div className="org-shell">
        <aside className="org-nav">
          <p className="org-nav-label">Organiser</p>
          {tournaments.map((t) => (
            <button
              key={t.tournament.id}
              className={`org-nav-item ${active?.tournament.id === t.tournament.id ? 'active' : ''}`}
              onClick={() => setSelectedId(t.tournament.id)}
            >
              {t.tournament.name}
            </button>
          ))}
          <button className="btn btn-ghost btn-block" onClick={() => setShowCreate(true)}>
            + New tournament
          </button>
          <div className="org-aside-note">
            <strong>Running an event?</strong>
            <p>Registration, payments, and live scoring in one place.</p>
          </div>
        </aside>

        <main className="org-main">
          {isLoading && <p>Loading...</p>}
          {!active && !isLoading && (
            <div className="org-empty">
              <h1>Running an event?</h1>
              <p>
                Set up registration, payments, and live scoring for your university. Create your first tournament to get
                started.
              </p>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                Create a tournament
              </button>
            </div>
          )}

          {active && (
            <>
              <header className="org-header">
                <div>
                  <h1>{active.tournament.name}</h1>
                  <p>
                    {active.tournament.status.replace(/_/g, ' ')} ·{' '}
                    <Link to={`/t/${active.tournament.slug}`}>Public page</Link> ·{' '}
                    <Link to={`/tournament/${active.tournament.slug}/display`}>TV display</Link>
                  </p>
                </div>
                <div className="org-header-actions">
                  {active.tournament.status === 'DRAFT' && (
                    <button className="btn btn-ghost" onClick={() => openMut.mutate()} disabled={openMut.isPending}>
                      Open registration
                    </button>
                  )}
                  {active.tournament.status === 'REGISTRATION_OPEN' && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => closeRegMut.mutate()}
                      disabled={closeRegMut.isPending}
                    >
                      Close registration
                    </button>
                  )}
                  {(active.tournament.status === 'REGISTRATION_CLOSED' ||
                    active.tournament.status === 'REGISTRATION_OPEN') &&
                    matches.length > 0 && (
                      <button className="btn btn-ghost" onClick={() => goLiveMut.mutate()} disabled={goLiveMut.isPending}>
                        Go LIVE
                      </button>
                    )}
                  {(active.tournament.status === 'DRAFT' ||
                    active.tournament.status === 'REGISTRATION_OPEN' ||
                    active.tournament.status === 'REGISTRATION_CLOSED') && (
                    <button
                      className="btn btn-primary"
                      onClick={() => setConfirmGenerate(true)}
                      disabled={generateMut.isPending}
                    >
                      Generate Tournament
                    </button>
                  )}
                </div>
              </header>

              <div className="org-stats">
                <div>
                  <strong>{active.players}</strong>
                  <span>Players</span>
                </div>
                {!isSingles && (
                  <div>
                    <strong>{active.teams}</strong>
                    <span>Teams</span>
                  </div>
                )}
                <div>
                  <strong>{formatMoney(active.revenue_cents)}</strong>
                  <span>Revenue</span>
                </div>
                <div>
                  <strong>
                    {active.paid_registrations}/{active.tournament.max_teams}
                  </strong>
                  <span>Registered</span>
                </div>
                <div>
                  <strong>{active.live_matches}</strong>
                  <span>Live matches</span>
                </div>
                <div>
                  <strong>
                    {active.checked_in}/{active.teams}
                  </strong>
                  <span>Checked in</span>
                </div>
              </div>

              <section className="org-section">
                <h2>Invite players</h2>
                <p className="muted org-section-lead">
                  Share this code or QR. Friends tap <strong>Have a code?</strong> on Tournaments.
                </p>
                {inviteCode ? (
                  <div className="org-invite">
                    <div className="org-invite-code">
                      <span className="org-invite-label">Join code</span>
                      <code className="share-code">{inviteCode}</code>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyInviteCode()}>
                        {codeCopied ? 'Copied' : 'Copy code'}
                      </button>
                    </div>
                    {joinUrl && <ShareQr url={joinUrl} openLabel="Open join page" />}
                  </div>
                ) : (
                  <p className="muted">Invite code will appear once the tournament is saved.</p>
                )}
              </section>

              <section className="org-section">
                <div className="org-section-head">
                  <h2>{isSingles ? 'Players & check-in' : 'Teams & check-in'}</h2>
                  {canAddTeams && (
                    <button type="button" className="btn btn-dark btn-sm" onClick={() => setShowAddTeam(true)}>
                      {isSingles ? 'Add player' : 'Add team'}
                    </button>
                  )}
                </div>
                <div className="org-table">
                  {(teams as Array<{ id: string; name: string; player_names: string[]; checked_in: boolean; payment_status: string }>).map(
                    (team) => (
                      <div key={team.id} className="org-row">
                        <div>
                          <strong>{team.name}</strong>
                          <span>{team.player_names?.join(' / ')}</span>
                        </div>
                        <div className="org-row-right">
                          <span className={`badge ${team.payment_status === 'PAID' ? 'badge-open' : 'badge-draft'}`}>
                            {team.payment_status || '-'}
                          </span>
                          {team.checked_in ? (
                            <span className="checked">✓ Checked in</span>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => checkInMut.mutate(team.id)}>
                              Check in
                            </button>
                          )}
                        </div>
                      </div>
                    ),
                  )}
                  {teams.length === 0 && (
                    <p className="muted">
                      {isSingles
                        ? 'No players registered yet. Share the invite or add a player.'
                        : 'No teams registered yet. Share the invite or add a team.'}
                    </p>
                  )}
                </div>
              </section>

              <section className="org-section">
                <div className="org-section-head">
                  <h2>Matches & scoring</h2>
                  {matches.some((m) => m.stage === 'KNOCKOUT' && (!m.team_a_id || !m.team_b_id)) &&
                    matches.some((m) => m.stage === 'GROUP') && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={seedKoMut.isPending}
                        onClick={() => seedKoMut.mutate()}
                      >
                        {seedKoMut.isPending ? 'Seeding…' : 'Seed knockout'}
                      </button>
                    )}
                </div>
                <div className="org-table">
                  {matches.map((m) => {
                    const canScore = !!(m.team_a_id && m.team_b_id)
                    return (
                      <div key={m.id} className="org-row">
                        <div>
                          <strong>
                            {m.round.replace(/_/g, ' ')} · {courtLabel(m.court_name, m.court_number)}
                            {m.scheduled_start ? ` · ${formatTime(m.scheduled_start)}` : ''}
                          </strong>
                          <span>
                            {m.team_a_name || m.team_a_placeholder || 'TBD'} vs{' '}
                            {m.team_b_name || m.team_b_placeholder || 'TBD'}
                          </span>
                        </div>
                        <div className="org-row-right">
                          <span className="badge badge-draft">{m.status}</span>
                          <button
                            className="btn btn-dark btn-sm"
                            disabled={!canScore}
                            title={canScore ? 'Enter score' : 'Waiting for teams to be seeded'}
                            onClick={() => {
                              if (!canScore) return
                              setScoreMatch(m)
                              setScoreForm({
                                set1_a: m.score?.set1_a ?? 0,
                                set1_b: m.score?.set1_b ?? 0,
                                set2_a: m.score?.set2_a ?? 0,
                                set2_b: m.score?.set2_b ?? 0,
                                set3_a: m.score?.set3_a ?? 0,
                                set3_b: m.score?.set3_b ?? 0,
                                current_set: m.score?.current_set ?? 1,
                                status: m.status === 'SCHEDULED' ? 'LIVE' : m.status,
                                winner_id: m.winner_id || '',
                              })
                            }}
                          >
                            Score
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {matches.length === 0 && (
                    <p className="muted">Generate the tournament to create fixtures.</p>
                  )}
                </div>
              </section>

              <section className="org-section">
                <h2>Announcement</h2>
                <div className="form-group">
                  <input
                    className="form-input"
                    placeholder="Title"
                    value={announce.title}
                    onChange={(e) => setAnnounce({ ...announce, title: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <textarea
                    className="form-textarea"
                    placeholder="Court 4 matches delayed by 10 minutes"
                    value={announce.body}
                    onChange={(e) => setAnnounce({ ...announce, body: e.target.value })}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!announce.title || !announce.body}
                  onClick={() => announceMut.mutate()}
                >
                  Post announcement
                </button>
              </section>
            </>
          )}
        </main>
      </div>

      {showCreate && (
        <CreateTournamentModal
          onClose={() => setShowCreate(false)}
          onCreated={(msg, id) => {
            showToast(msg)
            if (id) setSelectedId(id)
          }}
        />
      )}

      {showAddTeam && tid && (
        <AddTeamModal
          tournamentId={tid}
          playFormat={isSingles ? 'SINGLES' : 'DOUBLES'}
          friends={friendOptions}
          onClose={() => setShowAddTeam(false)}
          onAdded={(msg) => {
            showToast(msg)
            qc.invalidateQueries({ queryKey: ['org-teams'] })
            qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
            qc.invalidateQueries({ queryKey: ['tournament', slug] })
          }}
        />
      )}

      {confirmGenerate && (
        <div className="modal-backdrop" onClick={() => setConfirmGenerate(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generate-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="generate-modal-title">Generate tournament?</h2>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
              This builds groups, fixtures, and the knockout bracket from <strong>paid</strong> teams.
              Registration will close.
              {matches.length > 0 && (
                <>
                  {' '}
                  <strong style={{ color: 'var(--danger)' }}>
                    Existing matches and groups will be replaced.
                  </strong>
                </>
              )}
            </p>
            <p style={{ marginBottom: '1rem' }}>
              Paid teams ready: <strong>{active?.paid_registrations ?? 0}</strong>
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmGenerate(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={generateMut.isPending || (active?.paid_registrations ?? 0) < 2}
                onClick={() => generateMut.mutate()}
              >
                {generateMut.isPending ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scoreMatch && (
        <div className="modal-backdrop" onClick={() => setScoreMatch(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-entry-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="score-entry-title">Enter score</h2>
            <p>
              {scoreMatch.team_a_name || 'Team A'} vs {scoreMatch.team_b_name || 'Team B'}
            </p>
            {(['set1', 'set2', 'set3'] as const).map((set) => (
              <div key={set} className="score-row">
                <label>{set.replace('set', 'Set ')}</label>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  aria-label={`${set.replace('set', 'Set ')} team A`}
                  value={scoreForm[`${set}_a` as 'set1_a']}
                  onChange={(e) =>
                    setScoreForm({ ...scoreForm, [`${set}_a`]: Number(e.target.value) })
                  }
                />
                <span>-</span>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  aria-label={`${set.replace('set', 'Set ')} team B`}
                  value={scoreForm[`${set}_b` as 'set1_b']}
                  onChange={(e) =>
                    setScoreForm({ ...scoreForm, [`${set}_b`]: Number(e.target.value) })
                  }
                />
              </div>
            ))}
            <div className="form-group">
              <label className="form-label">Status</label>
              <select
                className="form-select"
                value={scoreForm.status}
                onChange={(e) => setScoreForm({ ...scoreForm, status: e.target.value })}
              >
                <option value="LIVE">Live</option>
                <option value="COMPLETED">Completed</option>
                <option value="WALKOVER">Walkover</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Winner (when completed)</label>
              <select
                className="form-select"
                value={scoreForm.winner_id}
                onChange={(e) => setScoreForm({ ...scoreForm, winner_id: e.target.value })}
              >
                <option value="">Auto from scores</option>
                {scoreMatch.team_a_id && (
                  <option value={scoreMatch.team_a_id}>{scoreMatch.team_a_name}</option>
                )}
                {scoreMatch.team_b_id && (
                  <option value={scoreMatch.team_b_id}>{scoreMatch.team_b_name}</option>
                )}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setScoreMatch(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => scoreMut.mutate()} disabled={scoreMut.isPending}>
                {scoreMut.isPending ? 'Saving...' : 'Save score'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function AddTeamModal({
  tournamentId,
  playFormat = 'DOUBLES',
  friends,
  onClose,
  onAdded,
}: {
  tournamentId: string
  playFormat?: string
  friends: Array<{ user_id: string; full_name: string; university_short?: string | null }>
  onClose: () => void
  onAdded: (msg: string) => void
}) {
  const singles = playFormat === 'SINGLES'
  const [teamName, setTeamName] = useState('')
  const [player1Id, setPlayer1Id] = useState('')
  const [player2Id, setPlayer2Id] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<PlayerSearch[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: searchResults = [] } = useQuery({
    queryKey: ['player-search-org', search],
    queryFn: async () => (await communityApi.searchPlayers(search.trim())).data,
    enabled: search.trim().length >= 2,
  })

  const options = useMemo(() => {
    const byId = new Map<string, { user_id: string; full_name: string; university_short?: string | null }>()
    for (const f of friends) {
      byId.set(f.user_id, f)
    }
    for (const p of picked) {
      byId.set(p.id, {
        user_id: p.id,
        full_name: p.full_name,
        university_short: p.university_short,
      })
    }
    return Array.from(byId.values())
  }, [friends, picked])

  const addFromSearch = (p: PlayerSearch) => {
    setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
    if (!player1Id) setPlayer1Id(p.id)
    else if (!singles && !player2Id && p.id !== player1Id) setPlayer2Id(p.id)
    setSearch('')
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (teamName.trim().length < 2) {
      setError(singles ? 'Enter a player / entry name' : 'Enter a team name')
      return
    }
    if (!player1Id) {
      setError('Pick a player')
      return
    }
    if (!singles && (!player2Id || player1Id === player2Id)) {
      setError('Pick two different players')
      return
    }
    setSaving(true)
    try {
      await tournamentApi.organiserAddTeam(tournamentId, {
        team_name: teamName.trim(),
        player1_id: player1Id,
        ...(singles ? {} : { player2_id: player2Id }),
      })
      onAdded(singles ? 'Player added (entry fee waived)' : 'Team added (entry fee waived)')
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not add entry'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-team-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-team-title">{singles ? 'Add player' : 'Add team'}</h2>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          {singles
            ? 'Adds a singles entry and marks them paid (fee waived).'
            : 'Adds a doubles pair and marks them paid (fee waived). Use friends or search by name.'}
        </p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="add-team-name">
              {singles ? 'Entry name' : 'Team name'}
            </label>
            <input
              id="add-team-name"
              className="form-input"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              required
              minLength={2}
              placeholder={singles ? 'e.g. Aoife Murphy' : 'e.g. UL Smash'}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="add-p1">
              {singles ? 'Player' : 'Player 1'}
            </label>
            <select
              id="add-p1"
              className="form-select"
              value={player1Id}
              onChange={(e) => setPlayer1Id(e.target.value)}
              required
            >
              <option value="">Select player</option>
              {options.map((p) => (
                <option key={p.user_id} value={p.user_id} disabled={p.user_id === player2Id}>
                  {p.full_name}
                  {p.university_short ? ` (${p.university_short})` : ''}
                </option>
              ))}
            </select>
          </div>
          {!singles && (
            <div className="form-group">
              <label className="form-label" htmlFor="add-p2">
                Player 2
              </label>
              <select
                id="add-p2"
                className="form-select"
                value={player2Id}
                onChange={(e) => setPlayer2Id(e.target.value)}
                required
              >
                <option value="">Select player</option>
                {options.map((p) => (
                  <option key={p.user_id} value={p.user_id} disabled={p.user_id === player1Id}>
                    {p.full_name}
                    {p.university_short ? ` (${p.university_short})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="add-search">
              Search players
            </label>
            <input
              id="add-search"
              className="form-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type a name"
              autoComplete="off"
            />
            {search.trim().length >= 2 && (
              <div className="org-search-results">
                {searchResults.length === 0 && <p className="muted-note">No matches</p>}
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="org-search-hit"
                    onClick={() => addFromSearch(p)}
                  >
                    <strong>{p.full_name}</strong>
                    <span>
                      {p.university_short || 'Player'} · {p.points} pts
                    </span>
                  </button>
                ))}
              </div>
            )}
            {friends.length === 0 && options.length === 0 && (
              <p className="muted-note">Add friends in Community, or search for players above.</p>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Adding...' : singles ? 'Add player' : 'Add team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CreateTournamentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (msg: string, id?: string) => void
}) {
  const qc = useQueryClient()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [form, setForm] = useState({
    name: '',
    location: '',
    venue: '',
    event_date: '',
    start_time: '10:00',
    number_of_courts: 6,
    entry_fee_euros: 50,
    max_teams: 48,
    format: 'GROUP_KNOCKOUT',
    play_format: 'DOUBLES',
    match_duration_minutes: 20,
    group_size: 4,
    teams_advance_per_group: 2,
  })
  const [courtNames, setCourtNames] = useState<string[]>(
    Array.from({ length: 6 }, (_, i) => `Court ${i + 1}`),
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const setCourtCount = (n: number) => {
    const count = Math.max(1, Math.min(32, n || 1))
    setForm((f) => ({ ...f, number_of_courts: count }))
    setCourtNames((prev) => {
      const next = [...prev]
      while (next.length < count) next.push(`Court ${next.length + 1}`)
      return next.slice(0, count)
    })
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const { data } = await tournamentApi.create({
        name: form.name,
        location: form.location,
        venue: form.venue,
        event_date: form.event_date,
        start_time: form.start_time.length === 5 ? `${form.start_time}:00` : form.start_time,
        number_of_courts: form.number_of_courts,
        court_names: courtNames.map((n, i) => n.trim() || `Court ${i + 1}`),
        entry_fee_cents: Math.round(form.entry_fee_euros * 100),
        max_teams: form.max_teams,
        format: form.format,
        play_format: form.play_format,
        match_duration_minutes: form.match_duration_minutes,
        group_size: form.group_size,
        teams_advance_per_group: form.teams_advance_per_group,
      })
      await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      onCreated('Tournament created', data.id)
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not create tournament'))
    } finally {
      setSaving(false)
    }
  }

  const singles = form.play_format === 'SINGLES'
  const entryUnit = singles ? 'player' : 'doubles team'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-tournament-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="create-tournament-title">Create tournament</h2>
        <form onSubmit={onSubmit}>
          {(
            [
              ['name', 'Name'],
              ['location', 'Location'],
              ['venue', 'Venue'],
              ['event_date', 'Date', 'date'],
              ['start_time', 'Start time', 'time'],
            ] as const
          ).map(([key, label, type]) => (
            <div className="form-group" key={key}>
              <label className="form-label">{label}</label>
              <input
                className="form-input"
                type={type || 'text'}
                value={String(form[key as keyof typeof form])}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                required
              />
            </div>
          ))}

          <div className="form-group">
            <label className="form-label">Singles or doubles</label>
            <select
              className="form-select"
              value={form.play_format}
              onChange={(e) => setForm({ ...form, play_format: e.target.value })}
            >
              <option value="DOUBLES">Doubles (pairs)</option>
              <option value="SINGLES">Singles (1v1)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Bracket format</label>
            <select
              className="form-select"
              value={form.format}
              onChange={(e) => setForm({ ...form, format: e.target.value })}
            >
              <option value="GROUP_KNOCKOUT">Groups then knockout</option>
              <option value="ROUND_ROBIN">Round robin</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Number of courts</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={32}
              value={form.number_of_courts}
              onChange={(e) => setCourtCount(Number(e.target.value))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Court names</label>
            <p className="muted" style={{ marginBottom: 8, fontSize: '0.85rem' }}>
              Shown to players and on the TV board — e.g. Glass Court, Court 3.
            </p>
            <div className="court-name-grid">
              {courtNames.map((name, i) => (
                <input
                  key={i}
                  className="form-input"
                  value={name}
                  onChange={(e) => {
                    const next = [...courtNames]
                    next[i] = e.target.value
                    setCourtNames(next)
                  }}
                  placeholder={`Court ${i + 1}`}
                  aria-label={`Court ${i + 1} name`}
                />
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Match length (minutes)</label>
            <input
              className="form-input"
              type="number"
              min={5}
              max={120}
              value={form.match_duration_minutes}
              onChange={(e) =>
                setForm({ ...form, match_duration_minutes: Number(e.target.value) || 20 })
              }
            />
            <p className="muted" style={{ marginTop: 6, fontSize: '0.85rem' }}>
              Used to schedule start times across courts.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Max {singles ? 'players' : 'doubles teams'}</label>
            <input
              className="form-input"
              type="number"
              min={2}
              max={256}
              value={form.max_teams}
              onChange={(e) => setForm({ ...form, max_teams: Number(e.target.value) })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Entry fee (€ per {entryUnit})</label>
            <input
              className="form-input"
              type="number"
              min={0}
              step={1}
              value={form.entry_fee_euros}
              onChange={(e) => setForm({ ...form, entry_fee_euros: Number(e.target.value) })}
            />
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: '1rem' }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide advanced' : 'Advanced options'}
          </button>

          {showAdvanced && form.format === 'GROUP_KNOCKOUT' && (
            <>
              <div className="form-group">
                <label className="form-label">Teams per group</label>
                <input
                  className="form-input"
                  type="number"
                  min={2}
                  max={8}
                  value={form.group_size}
                  onChange={(e) => setForm({ ...form, group_size: Number(e.target.value) || 4 })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Advance to knockout per group</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={4}
                  value={form.teams_advance_per_group}
                  onChange={(e) =>
                    setForm({ ...form, teams_advance_per_group: Number(e.target.value) || 2 })
                  }
                />
              </div>
            </>
          )}

          {error && <p className="auth-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
