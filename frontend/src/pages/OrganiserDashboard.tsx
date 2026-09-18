import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, platformApi, tournamentApi, type Match } from '../services/api'
import './Organiser.css'

export default function OrganiserDashboard() {
  const { user, loading: authLoading } = useAuth()
  const qc = useQueryClient()
  const canOrganise = !!user && (user.role === 'ORGANISER' || user.role === 'ADMIN')
  const { data, isLoading } = useQuery({
    queryKey: ['organiser-dashboard'],
    queryFn: async () => (await platformApi.organiserDashboard()).data,
    enabled: canOrganise,
  })

  const [toast, setToast] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmGenerate, setConfirmGenerate] = useState(false)
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

  const tournaments = (data?.tournaments || []) as Array<{
    tournament: {
      id: string
      name: string
      slug: string
      status: string
      max_teams: number
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
      showToast(apiErrorMessage(e, 'Generate failed — need 2+ paid teams'))
    },
  })

  const openMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'REGISTRATION_OPEN' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      showToast('Registration opened')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not open registration')),
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
      showToast('Team checked in')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Check-in failed')),
  })

  if (authLoading) {
    return (
      <div>
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '40%' }} />
        </main>
      </div>
    )
  }

  if (!canOrganise) {
    return (
      <div>
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
        </aside>

        <main className="org-main">
          {isLoading && <p>Loading…</p>}
          {!active && !isLoading && (
            <div>
              <h1>No tournaments yet</h1>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                Create your first tournament
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
                  {(active.tournament.status === 'REGISTRATION_CLOSED' ||
                    active.tournament.status === 'REGISTRATION_OPEN') &&
                    matches.length > 0 && (
                      <button className="btn btn-ghost" onClick={() => goLiveMut.mutate()} disabled={goLiveMut.isPending}>
                        Go LIVE
                      </button>
                    )}
                  <button
                    className="btn btn-primary"
                    onClick={() => setConfirmGenerate(true)}
                    disabled={generateMut.isPending}
                  >
                    Generate Tournament
                  </button>
                </div>
              </header>

              <div className="org-stats">
                <div>
                  <strong>{active.players}</strong>
                  <span>Players</span>
                </div>
                <div>
                  <strong>{active.teams}</strong>
                  <span>Teams</span>
                </div>
                <div>
                  <strong>€{(active.revenue_cents / 100).toFixed(0)}</strong>
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
                <h2>Teams & check-in</h2>
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
                            {team.payment_status || '—'}
                          </span>
                          {team.checked_in ? (
                            <span className="checked">✓ Checked in</span>
                          ) : (
                            <button className="btn btn-ghost" style={{ minHeight: 36 }} onClick={() => checkInMut.mutate(team.id)}>
                              Check in
                            </button>
                          )}
                        </div>
                      </div>
                    ),
                  )}
                  {teams.length === 0 && <p className="muted">No teams registered yet.</p>}
                </div>
              </section>

              <section className="org-section">
                <h2>Matches & scoring</h2>
                <div className="org-table">
                  {matches.slice(0, 40).map((m) => (
                    <div key={m.id} className="org-row">
                      <div>
                        <strong>
                          {m.round.replace(/_/g, ' ')} · Court {m.court_number ?? '—'}
                        </strong>
                        <span>
                          {m.team_a_name || m.team_a_placeholder || 'TBD'} vs{' '}
                          {m.team_b_name || m.team_b_placeholder || 'TBD'}
                        </span>
                      </div>
                      <div className="org-row-right">
                        <span className="badge badge-draft">{m.status}</span>
                        <button
                          className="btn btn-dark"
                          style={{ minHeight: 36 }}
                          onClick={() => {
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
                  ))}
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
                    placeholder="Court 4 matches delayed by 10 minutes…"
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

      {showCreate && <CreateTournamentModal onClose={() => setShowCreate(false)} onCreated={showToast} />}

      {confirmGenerate && (
        <div className="modal-backdrop" onClick={() => setConfirmGenerate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Generate tournament?</h2>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
              This builds groups, fixtures, and the knockout bracket from <strong>paid</strong> teams.
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
                {generateMut.isPending ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scoreMatch && (
        <div className="modal-backdrop" onClick={() => setScoreMatch(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Enter score</h2>
            <p>
              {scoreMatch.team_a_name || 'Team A'} vs {scoreMatch.team_b_name || 'Team B'}
            </p>
            {(['set1', 'set2', 'set3'] as const).map((set) => (
              <div key={set} className="score-row">
                <label>{set.replace('set', 'Set ')}</label>
                <input
                  type="number"
                  min={0}
                  value={scoreForm[`${set}_a` as 'set1_a']}
                  onChange={(e) =>
                    setScoreForm({ ...scoreForm, [`${set}_a`]: Number(e.target.value) })
                  }
                />
                <span>–</span>
                <input
                  type="number"
                  min={0}
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
                <option value="">—</option>
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
                {scoreMut.isPending ? 'Saving…' : 'Save score'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateTournamentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (msg: string) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '',
    location: '',
    venue: '',
    event_date: '',
    start_time: '10:00',
    number_of_courts: 6,
    entry_fee_euros: 50,
    max_teams: 48,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await tournamentApi.create({
        name: form.name,
        location: form.location,
        venue: form.venue,
        event_date: form.event_date,
        start_time: form.start_time.length === 5 ? `${form.start_time}:00` : form.start_time,
        number_of_courts: form.number_of_courts,
        entry_fee_cents: Math.round(form.entry_fee_euros * 100),
        max_teams: form.max_teams,
        format: 'GROUP_KNOCKOUT',
      })
      await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      onCreated('Tournament created')
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not create tournament'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create tournament</h2>
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
            <label className="form-label">Courts</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={32}
              value={form.number_of_courts}
              onChange={(e) => setForm({ ...form, number_of_courts: Number(e.target.value) })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max teams</label>
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
            <label className="form-label">Entry fee (€)</label>
            <input
              className="form-input"
              type="number"
              min={0}
              step={1}
              value={form.entry_fee_euros}
              onChange={(e) => setForm({ ...form, entry_fee_euros: Number(e.target.value) })}
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
