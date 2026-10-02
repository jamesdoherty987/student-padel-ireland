import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, platformApi, tournamentApi, type Match } from '../services/api'
import { formatMoney } from '../utils/format'
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
  const [editing, setEditing] = useState<string | null>(null)
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

  useEffect(() => {
    const open = showCreate || !!editing || confirmGenerate || !!scoreMatch
    document.body.classList.toggle('modal-open', open)
    return () => document.body.classList.remove('modal-open')
  }, [showCreate, editing, confirmGenerate, scoreMatch])

  useEffect(() => {
    if (!confirmGenerate && !scoreMatch && !editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setConfirmGenerate(false)
      setScoreMatch(null)
      setEditing(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmGenerate, scoreMatch, editing])

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
            <div key={t.tournament.id} className="org-nav-item-wrapper">
              <button
                className={`org-nav-item ${active?.tournament.id === t.tournament.id ? 'active' : ''}`}
                onClick={() => setSelectedId(t.tournament.id)}
              >
                {t.tournament.name}
              </button>
              <button
                className="org-nav-item-edit"
                onClick={() => setEditing(t.tournament.id)}
                title="Edit tournament"
              >
                <i className="fas fa-edit" />
              </button>
            </div>
          ))}
          <button className="btn btn-ghost btn-block" onClick={() => setShowCreate(true)}>
            + New tournament
          </button>
          <div className="org-aside-note">
            <strong>Running an event?</strong>
            <p>Registration, payments, and live scoring — all in one place.</p>
          </div>
        </aside>

        <main className="org-main">
          {isLoading && <p>Loading…</p>}
          {!active && !isLoading && (
            <div className="org-empty">
              <h1>Running an event?</h1>
              <p>
                Set up registration, payments, and live scoring for your university — create your first tournament to get
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
                <div>
                  <strong>{active.teams}</strong>
                  <span>Teams</span>
                </div>
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
                            <button className="btn btn-ghost btn-sm" onClick={() => checkInMut.mutate(team.id)}>
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
                          className="btn btn-dark btn-sm"
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

      {showCreate && (
        <CreateTournamentModal
          onClose={() => setShowCreate(false)}
          onCreated={(msg, id) => {
            showToast(msg)
            if (id) setSelectedId(id)
          }}
        />
      )}

      {editing && (
        <EditTournamentModal
          tournamentId={editing}
          tournaments={tournaments}
          onClose={() => setEditing(null)}
          onUpdated={(msg) => {
            showToast(msg)
            qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
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
                {generateMut.isPending ? 'Generating…' : 'Generate'}
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
                <span>–</span>
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
  onCreated: (msg: string, id?: string) => void
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
    description: '',
    rules: 'Best of 3 sets. Golden point on deuce. Student ID required on the day. Entry is per player.',
    registration_deadline: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

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
        entry_fee_cents: Math.round(form.entry_fee_euros * 100),
        max_teams: form.max_teams,
        format: 'GROUP_KNOCKOUT',
        description: form.description.trim() || null,
        rules: form.rules.trim() || null,
        registration_deadline: form.registration_deadline
          ? `${form.registration_deadline}T23:59:00`
          : null,
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
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
            <label className="form-label">Max doubles teams</label>
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
            <label className="form-label">Registration deadline (optional)</label>
            <input
              className="form-input"
              type="date"
              value={form.registration_deadline}
              onChange={(e) => setForm({ ...form, registration_deadline: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Entry fee (€ per player)</label>
            <input
              className="form-input"
              type="number"
              min={0}
              step={1}
              value={form.entry_fee_euros}
              onChange={(e) => setForm({ ...form, entry_fee_euros: Number(e.target.value) })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Rules</label>
            <textarea
              className="form-textarea"
              value={form.rules}
              onChange={(e) => setForm({ ...form, rules: e.target.value })}
              rows={3}
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

function EditTournamentModal({
  tournamentId,
  tournaments,
  onClose,
  onUpdated,
}: {
  tournamentId: string
  tournaments: Array<{ tournament: { id: string; name: string } }>
  onClose: () => void
  onUpdated: (msg: string) => void
}) {
  const qc = useQueryClient()
  const tournament = tournaments.find((t) => t.tournament.id === tournamentId)?.tournament
  const [form, setForm] = useState({
    name: tournament?.name || '',
    location: '',
    venue: '',
    event_date: '',
    start_time: '10:00',
    number_of_courts: 6,
    entry_fee_euros: 50,
    max_teams: 48,
    description: '',
    rules: '',
    registration_deadline: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingTournament, setLoadingTournament] = useState(true)

  useEffect(() => {
    const loadTournament = async () => {
      try {
        const { data } = await tournamentApi.get(tournamentId)
        setForm({
          name: data.name,
          location: data.location,
          venue: data.venue,
          event_date: data.event_date.slice(0, 10),
          start_time: data.start_time?.slice(0, 5) || '10:00',
          number_of_courts: data.number_of_courts,
          entry_fee_euros: Math.round(data.entry_fee_cents) / 100,
          max_teams: data.max_teams,
          description: data.description || '',
          rules: data.rules || '',
          registration_deadline: data.registration_deadline ? data.registration_deadline.slice(0, 10) : '',
        })
      } catch (err: unknown) {
        setError(apiErrorMessage(err, 'Could not load tournament'))
      } finally {
        setLoadingTournament(false)
      }
    }
    void loadTournament()
  }, [tournamentId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        location: form.location.trim(),
        venue: form.venue.trim(),
        event_date: form.event_date,
        start_time: form.start_time.length === 5 ? `${form.start_time}:00` : form.start_time,
        entry_fee_cents: Math.round(Number(form.entry_fee_euros) * 100),
        max_teams: Number(form.max_teams),
        description: form.description.trim() || null,
        rules: form.rules.trim() || null,
        registration_deadline: form.registration_deadline
          ? `${form.registration_deadline}T23:59:00`
          : null,
      }
      if (form.number_of_courts) {
        payload.number_of_courts = form.number_of_courts
      }
      await tournamentApi.update(tournamentId, payload)
      await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      onUpdated('Tournament updated')
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not update tournament'))
    } finally {
      setSaving(false)
    }
  }

  if (loadingTournament) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-tournament-title">
          <h2 id="edit-tournament-title">Loading…</h2>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-tournament-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-tournament-title">Edit tournament</h2>
        <p className="admin-modal-lead">Entry fee is per player.</p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              minLength={3}
              disabled={saving}
            />
          </div>
          <div className="admin-form-row admin-form-row-2">
            <div className="form-group">
              <label className="form-label">City</label>
              <input
                className="form-input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                required
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Venue</label>
              <input
                className="form-input"
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
                required
                disabled={saving}
              />
            </div>
          </div>
          <div className="admin-form-row admin-form-row-2">
            <div className="form-group">
              <label className="form-label">Event date</label>
              <input
                className="form-input"
                type="date"
                value={form.event_date}
                onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                required
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Start time</label>
              <input
                className="form-input"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                required
                disabled={saving}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Registration deadline (optional)</label>
            <input
              className="form-input"
              type="date"
              value={form.registration_deadline}
              onChange={(e) => setForm({ ...form, registration_deadline: e.target.value })}
              disabled={saving}
            />
          </div>
          <div className="admin-form-row">
            <div className="form-group">
              <label className="form-label">Courts</label>
              <input
                className="form-input"
                type="number"
                min={1}
                max={32}
                value={form.number_of_courts}
                onChange={(e) => setForm({ ...form, number_of_courts: Number(e.target.value) })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Max doubles teams</label>
              <input
                className="form-input"
                type="number"
                min={2}
                max={256}
                value={form.max_teams}
                onChange={(e) => setForm({ ...form, max_teams: Number(e.target.value) })}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label className="form-label">€ / player</label>
              <input
                className="form-input"
                type="number"
                min={0}
                step={1}
                value={form.entry_fee_euros}
                onChange={(e) => setForm({ ...form, entry_fee_euros: Number(e.target.value) })}
                disabled={saving}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Rules</label>
            <textarea
              className="form-textarea"
              value={form.rules}
              onChange={(e) => setForm({ ...form, rules: e.target.value })}
              rows={3}
              disabled={saving}
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
