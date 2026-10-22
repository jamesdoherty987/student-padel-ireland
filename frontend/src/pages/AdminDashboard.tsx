import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from '../components/ConfirmDialog'
import CreateTournamentModal from '../components/CreateTournamentModal'
import EditTournamentModal from '../components/EditTournamentModal'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { publicPathUrl, publicWebOrigin } from '../native/platform'
import {
  apiErrorMessage,
  platformApi,
  tournamentApi,
  type OrganiserDashRow,
  type Tournament,
} from '../services/api'
import { formatDate, formatEntrySummary, formatMoney, statusBadgeClass, statusLabel } from '../utils/format'
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

  const rows: OrganiserDashRow[] = data?.tournaments || []

  const openCount = rows.filter((r) => r.tournament.status === 'REGISTRATION_OPEN').length
  const liveCount = rows.filter((r) => r.tournament.status === 'LIVE').length
  const totalRevenue = rows.reduce((sum, r) => sum + (r.revenue_cents || 0), 0)

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  useEffect(() => {
    const open = showCreate || !!editing
    document.body.classList.toggle('modal-open', open)
    return () => document.body.classList.remove('modal-open')
  }, [showCreate, editing])

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
      showToast(`Status â†’ ${statusLabel(vars.status)}`)
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not update status')),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => tournamentApi.delete(id),
    onSuccess: (res, id) => {
      qc.setQueryData(['organiser-dashboard'], (old: unknown) => {
        const data = old as { tournaments?: Array<{ tournament: { id: string } }> } | undefined
        if (!data?.tournaments) return old
        return {
          ...data,
          tournaments: data.tournaments.filter((row) => row.tournament.id !== id),
        }
      })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      qc.invalidateQueries({ queryKey: ['tournaments'] })
      showToast(`Deleted "${res.data.deleted}"`)
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not delete tournament')),
  })

  const pendingStatusId = statusMut.isPending ? statusMut.variables?.id : null
  const pendingDeleteId = deleteMut.isPending ? deleteMut.variables : null

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
          </div>
          <div className="header-actions">
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
              New tournament
            </button>
          </div>
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
                busy={pendingStatusId === row.tournament.id || pendingDeleteId === row.tournament.id}
                onStatus={(status) => {
                  if (status === row.tournament.status) return
                  const needsConfirm =
                    status === 'LIVE' || status === 'COMPLETED' || status === 'CANCELLED'
                  const run = () => statusMut.mutate({ id: row.tournament.id, status })
                  if (!needsConfirm) {
                    run()
                    return
                  }
                  void confirmDialog({
                    title:
                      status === 'LIVE'
                        ? 'Go live?'
                        : status === 'COMPLETED'
                          ? 'Mark completed?'
                          : 'Cancel event?',
                    message:
                      status === 'LIVE'
                        ? `Start "${row.tournament.name}" for players?`
                        : status === 'COMPLETED'
                          ? `Mark "${row.tournament.name}" as completed?`
                          : `Cancel "${row.tournament.name}"?`,
                    confirmLabel:
                      status === 'LIVE' ? 'Go live' : status === 'COMPLETED' ? 'Mark completed' : 'Cancel event',
                    danger: status === 'CANCELLED',
                  }).then((ok) => {
                    if (ok) run()
                  })
                }}
                onEdit={() => setEditing(row.tournament)}
                onDelete={() => {
                  void confirmDialog({
                    title: 'Delete tournament?',
                    message: `Permanently delete "${row.tournament.name}"? This removes teams, matches, and scores.`,
                    confirmLabel: 'Delete',
                    danger: true,
                  }).then((ok) => {
                    if (ok) deleteMut.mutate(row.tournament.id)
                  })
                }}
                onCopied={(msg) => showToast(msg)}
              />
            ))}
          </ul>
        )}
      </main>

      {showCreate && (
        <CreateTournamentModal
          variant="admin"
          onClose={() => setShowCreate(false)}
          onToast={showToast}
          onCreated={(msg) => showToast(msg)}
        />
      )}

      {editing && (
        <EditTournamentModal
          tournament={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => showToast(msg)}
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
  onDelete,
  onCopied,
}: {
  row: OrganiserDashRow
  busy: boolean
  onStatus: (status: string) => void
  onEdit: () => void
  onDelete: () => void
  onCopied: (msg: string) => void
}) {
  const t = row.tournament
  const [moreOpen, setMoreOpen] = useState(false)
  const origin = publicWebOrigin()
  const publicUrl = `${origin}/t/${t.slug}`
  const joinUrl = t.invite_code
    ? publicPathUrl(`/join/${t.invite_code}`)
    : `${origin}/t/${t.slug}/join`

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
      onCopied('Could not copy. Copy the link from the address bar.')
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
            {formatEntrySummary(row.paid_registrations, t.max_teams, t.entry_fee_cents, t.currency, t.play_format)} · Revenue{' '}
            {formatMoney(row.revenue_cents)}
          </p>
        </div>
        <span className={`badge ${statusBadgeClass(t.status)}`}>{statusLabel(t.status)}</span>
      </div>

      <div className="admin-actions">
        <Link to={`/organiser?t=${t.id}`} className="btn btn-primary btn-sm">
          Day-of ops
        </Link>
        {quickAction && (
          <button
            type="button"
            className="btn btn-dark btn-sm"
            disabled={busy}
            onClick={() => onStatus(quickAction.status)}
          >
            {busy ? 'Updating...' : quickAction.label}
          </button>
        )}
        {t.status === 'REGISTRATION_CLOSED' && (
          <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => onStatus('LIVE')}>
            Go live
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          {moreOpen ? 'Less' : 'More'}
        </button>
      </div>

      {moreOpen && (
        <div className="admin-actions-more">
          <div className="admin-actions-group">
            <span className="admin-actions-label">Status</span>
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
          </div>
          <div className="admin-actions-group">
            <span className="admin-actions-label">Links</span>
            <div className="admin-actions">
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
            </div>
          </div>
          <div className="admin-actions-group admin-actions-danger">
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

