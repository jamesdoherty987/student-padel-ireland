import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, platformApi, tournamentApi, type Tournament } from '../services/api'
import { formatDate, formatDoublesEntry, formatMoney, statusBadgeClass, statusLabel } from '../utils/format'
import './Organiser.css'
import './Admin.css'

const STATUSES = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'LIVE',
  'COMPLETED',
  'CANCELLED',
] as const

type DashRow = {
  tournament: Tournament
  teams: number
  paid_registrations: number
  revenue_cents: number
}

type TournamentFormState = {
  name: string
  location: string
  venue: string
  event_date: string
  start_time: string
  number_of_courts: number
  entry_fee_euros: number
  max_teams: number
  description: string
  rules: string
  registration_deadline: string
  open_now: boolean
}

const EMPTY_FORM: TournamentFormState = {
  name: '',
  location: '',
  venue: '',
  event_date: '',
  start_time: '10:00',
  number_of_courts: 6,
  entry_fee_euros: 50,
  max_teams: 48,
  description: '',
  rules: 'Best of 3 sets. Golden point on deuce. Student ID required on the day. Entry is per doubles team.',
  registration_deadline: '',
  open_now: true,
}

const LIMERICK_TEMPLATE: TournamentFormState = {
  ...EMPTY_FORM,
  name: 'Limerick Open',
  location: 'Limerick',
  venue: 'UL Padel Centre',
  description: "Ireland's student padel open — doubles teams, groups then knockout.",
  open_now: true,
}

function localDateISO(daysAhead = 0) {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formFromTournament(t: Tournament): TournamentFormState {
  return {
    name: t.name,
    location: t.location,
    venue: t.venue,
    event_date: t.event_date.slice(0, 10),
    start_time: t.start_time?.slice(0, 5) || '10:00',
    number_of_courts: t.number_of_courts,
    entry_fee_euros: Math.round(t.entry_fee_cents) / 100,
    max_teams: t.max_teams,
    description: t.description || '',
    rules: t.rules || '',
    registration_deadline: t.registration_deadline ? t.registration_deadline.slice(0, 10) : '',
    open_now: false,
  }
}

function payloadFromForm(form: TournamentFormState, previous?: Tournament) {
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    location: form.location.trim(),
    venue: form.venue.trim(),
    event_date: form.event_date,
    start_time: form.start_time.length === 5 ? `${form.start_time}:00` : form.start_time,
    entry_fee_cents: Math.round(Number(form.entry_fee_euros) * 100),
    max_teams: Number(form.max_teams),
    format: 'GROUP_KNOCKOUT',
    description: form.description.trim() || null,
    rules: form.rules.trim() || null,
    registration_deadline: form.registration_deadline
      ? `${form.registration_deadline}T23:59:00Z`
      : null,
  }

  const courts = Number(form.number_of_courts)
  // Only send court count when creating, or when it actually changed (avoids wiping courts)
  if (!previous || previous.number_of_courts !== courts) {
    payload.number_of_courts = courts
  }

  return payload
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'
  const [showCreate, setShowCreate] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [editing, setEditing] = useState<Tournament | null>(null)
  const toastTimer = useRef<number | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['organiser-dashboard'],
    queryFn: async () => (await platformApi.organiserDashboard()).data,
    enabled: isAdmin,
  })

  const rows = (data?.tournaments || []) as DashRow[]

  const openCount = rows.filter((r) => r.tournament.status === 'REGISTRATION_OPEN').length
  const liveCount = rows.filter((r) => r.tournament.status === 'LIVE').length
  const totalRevenue = rows.reduce((sum, r) => sum + (r.revenue_cents || 0), 0)

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3000)
  }

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => tournamentApi.update(id, { status }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      qc.invalidateQueries({ queryKey: ['tournaments'] })
      showToast(`Status → ${statusLabel(vars.status)}`)
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not update status')),
  })

  const pendingStatusId = statusMut.isPending ? statusMut.variables?.id : null

  if (authLoading || (isLoading && isAdmin)) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '40%', marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 88, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 140 }} />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <NavBar />
      {toast && (
        <div className="org-toast" role="status">
          {toast}
        </div>
      )}
      <main className="page admin-page">
        <div className="page-header-row">
          <div>
            <p className="eyebrow">Admin</p>
            <h1 className="page-title">Official tournaments</h1>
            <p className="page-sub">
              Set up events, open registration, and manage status. Day-of scoring lives in Day-of ops.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            New tournament
          </button>
        </div>

        {rows.length > 0 && (
          <div className="admin-stats">
            <div>
              <strong>{rows.length}</strong>
              <span>Events</span>
            </div>
            <div>
              <strong>{openCount}</strong>
              <span>Open for entry</span>
            </div>
            <div>
              <strong>{liveCount}</strong>
              <span>Live</span>
            </div>
            <div>
              <strong>{formatMoney(totalRevenue)}</strong>
              <span>Revenue</span>
            </div>
          </div>
        )}

        {isError && (
          <div className="empty-state">
            <p>Could not load tournaments.</p>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}

        {!isError && rows.length === 0 && (
          <div className="empty-state">
            <p>No tournaments yet. Create an official event to get started.</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => setShowCreate(true)}
            >
              Create tournament
            </button>
          </div>
        )}

        {!isError && rows.length > 0 && (
          <ul className="admin-list">
            {rows.map((row) => (
              <AdminTournamentCard
                key={row.tournament.id}
                row={row}
                busy={pendingStatusId === row.tournament.id}
                onStatus={(status) => {
                  if (status === row.tournament.status) return
                  statusMut.mutate({ id: row.tournament.id, status })
                }}
                onEdit={() => setEditing(row.tournament)}
                onCopied={(msg) => showToast(msg)}
              />
            ))}
          </ul>
        )}
      </main>

      {showCreate && (
        <TournamentModal
          title="New official tournament"
          initial={{ ...EMPTY_FORM, event_date: localDateISO(21) }}
          submitLabel="Create tournament"
          showOpenNow
          showTemplate
          onClose={() => setShowCreate(false)}
          onSubmit={async (form) => {
            const { data: created } = await tournamentApi.create(payloadFromForm(form))
            if (form.open_now) {
              try {
                await tournamentApi.update(created.id, { status: 'REGISTRATION_OPEN' })
              } catch {
                await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
                await qc.invalidateQueries({ queryKey: ['tournaments'] })
                showToast('Created, but could not open registration — open it from the list')
                return
              }
            }
            await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
            await qc.invalidateQueries({ queryKey: ['tournaments'] })
            showToast(form.open_now ? 'Created & registration opened' : 'Created as draft')
          }}
        />
      )}

      {editing && (
        <TournamentModal
          title="Edit tournament"
          initial={formFromTournament(editing)}
          submitLabel="Save changes"
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            await tournamentApi.update(editing.id, payloadFromForm(form, editing))
            await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
            await qc.invalidateQueries({ queryKey: ['tournaments'] })
            showToast('Tournament updated')
          }}
        />
      )}
    </div>
  )
}

function AdminTournamentCard({
  row,
  busy,
  onStatus,
  onEdit,
  onCopied,
}: {
  row: DashRow
  busy: boolean
  onStatus: (status: string) => void
  onEdit: () => void
  onCopied: (msg: string) => void
}) {
  const t = row.tournament
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const publicUrl = `${origin}/t/${t.slug}`
  const joinUrl = `${origin}/t/${t.slug}/join`

  const quickAction =
    t.status === 'DRAFT' || t.status === 'REGISTRATION_CLOSED'
      ? { label: 'Open registration', status: 'REGISTRATION_OPEN' }
      : t.status === 'REGISTRATION_OPEN'
        ? { label: 'Close registration', status: 'REGISTRATION_CLOSED' }
        : t.status === 'LIVE'
          ? { label: 'Mark completed', status: 'COMPLETED' }
          : null

  const handleCopy = async (url: string, msg: string) => {
    try {
      await copyText(url)
      onCopied(msg)
    } catch {
      onCopied('Could not copy — copy from the address bar')
    }
  }

  return (
    <li className="admin-card">
      <div className="admin-card-top">
        <div>
          <h2>{t.name}</h2>
          <p>
            {t.location} · {t.venue} ·{' '}
            {formatDate(t.event_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            {t.start_time ? ` · ${t.start_time.slice(0, 5)}` : ''}
          </p>
          <p className="admin-meta">
            {formatDoublesEntry(row.paid_registrations, t.max_teams, t.entry_fee_cents, t.currency)} · Revenue{' '}
            {formatMoney(row.revenue_cents)}
          </p>
        </div>
        <span className={`badge ${statusBadgeClass(t.status)}`}>{statusLabel(t.status)}</span>
      </div>

      <div className="admin-actions">
        {quickAction && (
          <button
            type="button"
            className="btn btn-dark btn-sm"
            disabled={busy}
            onClick={() => onStatus(quickAction.status)}
          >
            {busy ? 'Updating…' : quickAction.label}
          </button>
        )}
        {t.status === 'REGISTRATION_CLOSED' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onStatus('LIVE')}>
            Go live
          </button>
        )}
        <select
          className="form-select admin-status"
          value={STATUSES.includes(t.status as (typeof STATUSES)[number]) ? t.status : 'DRAFT'}
          disabled={busy}
          onChange={(e) => onStatus(e.target.value)}
          aria-label={`Status for ${t.name}`}
        >
          {!STATUSES.includes(t.status as (typeof STATUSES)[number]) && (
            <option value={t.status}>{statusLabel(t.status)}</option>
          )}
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleCopy(publicUrl, 'Public link copied')}>
          Copy link
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleCopy(joinUrl, 'Join link copied')}>
          Copy join link
        </button>
        <Link to={`/t/${t.slug}`} className="btn btn-ghost btn-sm">
          Public page
        </Link>
        <Link to={`/tournament/${t.slug}/display`} className="btn btn-ghost btn-sm">
          TV
        </Link>
        <Link to={`/organiser?t=${t.id}`} className="btn btn-ghost btn-sm">
          Day-of ops
        </Link>
      </div>
    </li>
  )
}

function TournamentModal({
  title,
  initial,
  submitLabel,
  showOpenNow = false,
  showTemplate = false,
  onClose,
  onSubmit,
}: {
  title: string
  initial: TournamentFormState
  submitLabel: string
  showOpenNow?: boolean
  showTemplate?: boolean
  onClose: () => void
  onSubmit: (form: TournamentFormState) => Promise<void>
}) {
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const set = <K extends keyof TournamentFormState>(key: K, value: TournamentFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setError('')
    setSaving(true)
    try {
      await onSubmit(form)
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Something went wrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal admin-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="admin-modal-head">
          <h2>{title}</h2>
          {showTemplate && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={saving}
              onClick={() => setForm({ ...LIMERICK_TEMPLATE, event_date: form.event_date || localDateISO(21) })}
            >
              Limerick Open template
            </button>
          )}
        </div>
        <p className="admin-modal-lead">Entry fee is per doubles team (2 players).</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
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
                onChange={(e) => set('location', e.target.value)}
                required
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Venue</label>
              <input
                className="form-input"
                value={form.venue}
                onChange={(e) => set('venue', e.target.value)}
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
                onChange={(e) => set('event_date', e.target.value)}
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
                onChange={(e) => set('start_time', e.target.value)}
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
              onChange={(e) => set('registration_deadline', e.target.value)}
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
                onChange={(e) => set('number_of_courts', Number(e.target.value))}
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
                onChange={(e) => set('max_teams', Number(e.target.value))}
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label className="form-label">€ / doubles team</label>
              <input
                className="form-input"
                type="number"
                min={0}
                step={1}
                value={form.entry_fee_euros}
                onChange={(e) => set('entry_fee_euros', Number(e.target.value))}
                disabled={saving}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Rules</label>
            <textarea
              className="form-textarea"
              value={form.rules}
              onChange={(e) => set('rules', e.target.value)}
              rows={3}
              disabled={saving}
            />
          </div>
          {showOpenNow && (
            <label className="admin-check">
              <input
                type="checkbox"
                checked={form.open_now}
                onChange={(e) => set('open_now', e.target.checked)}
                disabled={saving}
              />
              Open registration immediately
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
