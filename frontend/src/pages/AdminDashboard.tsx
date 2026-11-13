import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from '../components/ConfirmDialog'
import CreateTournamentModal from '../components/CreateTournamentModal'
import EditTournamentModal from '../components/EditTournamentModal'
import ModalShell from '../components/ModalShell'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { publicPathUrl, publicWebOrigin } from '../native/platform'
import {
  adminApi,
  apiErrorMessage,
  platformApi,
  tournamentApi,
  type AdminTournamentEntries,
  type AdminUser,
  type AdminUserDetail,
  type OrganiserDashRow,
  type Tournament,
} from '../services/api'
import {
  formatDate,
  formatDateTime,
  formatEntrySummary,
  formatMoney,
  statusBadgeClass,
  statusLabel,
} from '../utils/format'
import './Organiser.css'
import './Admin.css'

type AdminTab = 'tournaments' | 'accounts'

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
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'
  const [tab, setTab] = useState<AdminTab>('tournaments')
  const [showPrivate, setShowPrivate] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [editing, setEditing] = useState<Tournament | null>(null)
  const [editingFixturesExist, setEditingFixturesExist] = useState(false)
  const [entriesFor, setEntriesFor] = useState<Tournament | null>(null)
  const toastTimer = useRef<number | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['organiser-dashboard'],
    queryFn: async () => (await platformApi.organiserDashboard()).data,
    enabled: isAdmin,
  })

  const allRows: OrganiserDashRow[] = data?.tournaments || []
  const privateCount = allRows.filter((r) => !r.tournament.is_official).length
  const rows = useMemo(
    () => (showPrivate ? allRows : allRows.filter((r) => r.tournament.is_official !== false)),
    [allRows, showPrivate],
  )

  const openCount = rows.filter((r) => r.tournament.status === 'REGISTRATION_OPEN').length
  const liveCount = rows.filter((r) => r.tournament.status === 'LIVE').length
  const totalRevenue = rows.reduce((sum, r) => sum + (r.revenue_cents || 0), 0)

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  useEffect(() => {
    const open = showCreate || !!editing || !!entriesFor
    document.body.classList.toggle('modal-open', open)
    return () => document.body.classList.remove('modal-open')
  }, [showCreate, editing, entriesFor])

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

  if (authLoading || (isLoading && isAdmin && tab === 'tournaments')) {
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
            <h1 className="page-title">Platform control</h1>
            <p className="page-sub">
              Create official events, open registration, generate draws, go live, and manage accounts.
            </p>
          </div>
          {tab === 'tournaments' && (
            <div className="header-actions">
              <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
                New tournament
              </button>
            </div>
          )}
        </div>

        <div className="admin-tabs" role="tablist" aria-label="Admin sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tournaments'}
            className={`admin-tab${tab === 'tournaments' ? ' is-active' : ''}`}
            onClick={() => setTab('tournaments')}
          >
            Tournaments
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'accounts'}
            className={`admin-tab${tab === 'accounts' ? ' is-active' : ''}`}
            onClick={() => setTab('accounts')}
          >
            Accounts
          </button>
        </div>

        {tab === 'tournaments' && (
          <>
            <p className="admin-flow-hint muted-note">
              Flow: create → open registration → <strong>Manage event</strong> → generate draw → go live → score.
            </p>

            {allRows.length > 0 && (
              <div className="admin-stats">
                <div>
                  <strong>{rows.length}</strong>
                  <span>{showPrivate ? 'Shown' : 'Official'}</span>
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

            {privateCount > 0 && (
              <label className="admin-check admin-filter-check">
                <input
                  type="checkbox"
                  checked={showPrivate}
                  onChange={(e) => setShowPrivate(e.target.checked)}
                />
                Show private player events ({privateCount})
              </label>
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
                <p>
                  {showPrivate
                    ? 'No tournaments yet.'
                    : privateCount > 0
                      ? 'No official tournaments yet. Create one, or show private player events.'
                      : 'No official tournaments yet. Create one to get started.'}
                </p>
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
                    onOpenRegistration={() =>
                      statusMut.mutate({ id: row.tournament.id, status: 'REGISTRATION_OPEN' })
                    }
                    onEdit={() => {
                      setEditing(row.tournament)
                      setEditingFixturesExist(!!row.has_fixtures)
                    }}
                    onEntries={() => setEntriesFor(row.tournament)}
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
          </>
        )}

        {tab === 'accounts' && <AdminAccountsPanel onToast={showToast} />}
      </main>

      {showCreate && (
        <CreateTournamentModal
          onClose={() => setShowCreate(false)}
          onToast={showToast}
          onCreated={(msg, id) => {
            showToast(msg)
            if (id) navigate(`/organiser?t=${id}`)
          }}
        />
      )}

      {editing && (
        <EditTournamentModal
          tournament={editing}
          fixturesExist={editingFixturesExist}
          onClose={() => {
            setEditing(null)
            setEditingFixturesExist(false)
          }}
          onSaved={(msg) => showToast(msg)}
        />
      )}

      {entriesFor && (
        <AdminEntriesModal
          tournament={entriesFor}
          onClose={() => setEntriesFor(null)}
          onToast={showToast}
        />
      )}
    </div>
  )
}

function AdminTournamentCard({
  row,
  busy,
  onOpenRegistration,
  onEdit,
  onEntries,
  onDelete,
  onCopied,
}: {
  row: OrganiserDashRow
  busy: boolean
  onOpenRegistration: () => void
  onEdit: () => void
  onEntries: () => void
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
            {t.is_official === false ? 'Private · ' : 'Official · '}
            {formatEntrySummary(row.paid_registrations, t.max_teams, t.entry_fee_cents, t.currency, t.play_format)} · Revenue{' '}
            {formatMoney(row.revenue_cents)}
          </p>
        </div>
        <span className={`badge ${statusBadgeClass(t.status)}`}>{statusLabel(t.status)}</span>
      </div>

      <div className="admin-actions">
        <Link to={`/organiser?t=${t.id}`} className="btn btn-primary btn-sm">
          Manage event
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEntries}>
          Entries
        </button>
        {(t.status === 'DRAFT' || t.status === 'REGISTRATION_CLOSED') && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={onOpenRegistration}
          >
            {busy ? 'Updating…' : 'Open registration'}
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
          <p className="muted-note admin-manage-hint">
            Draw, scoring, go live, and complete are under <strong>Manage event</strong>. Use{' '}
            <strong>Entries</strong> to remove players quickly.
          </p>
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

type EntriesPaymentFilter = 'all' | 'paid' | 'owing' | 'other'
type EntriesCheckInFilter = 'all' | 'in' | 'out'
type EntriesSort = 'newest' | 'oldest' | 'name'

function adminPaymentBucket(team: {
  payment_status?: string | null
  payment_via?: string | null
}): EntriesPaymentFilter {
  if (team.payment_status === 'PENDING' || team.payment_status === 'FAILED') return 'owing'
  if (team.payment_status === 'PAID' && team.payment_via === 'pay_on_arrival') return 'owing'
  if (team.payment_status === 'PAID') return 'paid'
  return 'other'
}

function AdminEntriesModal({
  tournament,
  onClose,
  onToast,
}: {
  tournament: Tournament
  onClose: () => void
  onToast: (msg: string) => void
}) {
  const qc = useQueryClient()
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-tournament-entries', tournament.id, includeWithdrawn],
    queryFn: async () => (await adminApi.tournamentEntries(tournament.id, includeWithdrawn)).data,
  })

  const removeMut = useMutation({
    mutationFn: (userId: string) => adminApi.removePlayerFromTournament(tournament.id, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tournament-entries', tournament.id] })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      onToast('Player removed from tournament')
    },
    onError: (e: unknown) => onToast(apiErrorMessage(e, 'Could not remove player')),
  })

  return (
    <ModalShell
      title={`Entries · ${tournament.name}`}
      titleId="admin-entries-title"
      subtitle="Remove a team by withdrawing any player on it."
      onClose={onClose}
      wide
      className="admin-modal"
    >
      {isLoading && <div className="skeleton" style={{ height: 120 }} />}
      {isError && (
        <div className="empty-state">
          <p>Could not load entries.</p>
          <button type="button" className="btn btn-ghost" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}
      {data && (
        <AdminEntriesList
          data={data}
          includeWithdrawn={includeWithdrawn}
          onIncludeWithdrawnChange={setIncludeWithdrawn}
          busyUserId={removeMut.isPending ? removeMut.variables : null}
          onRemove={(userId, name) => {
            void confirmDialog({
              title: 'Remove from tournament?',
              message: `Withdraw ${name}'s team from "${tournament.name}"?`,
              confirmLabel: 'Remove',
              danger: true,
            }).then((ok) => {
              if (ok) removeMut.mutate(userId)
            })
          }}
        />
      )}
    </ModalShell>
  )
}

function AdminEntriesList({
  data,
  includeWithdrawn,
  onIncludeWithdrawnChange,
  busyUserId,
  onRemove,
}: {
  data: AdminTournamentEntries
  includeWithdrawn: boolean
  onIncludeWithdrawnChange: (v: boolean) => void
  busyUserId: string | null
  onRemove: (userId: string, name: string) => void
}) {
  const [q, setQ] = useState('')
  const [paymentFilter, setPaymentFilter] = useState<EntriesPaymentFilter>('all')
  const [checkInFilter, setCheckInFilter] = useState<EntriesCheckInFilter>('all')
  const [sort, setSort] = useState<EntriesSort>('newest')

  const counts = useMemo(() => {
    let paid = 0
    let owing = 0
    let other = 0
    let checkedIn = 0
    let notCheckedIn = 0
    for (const team of data.teams) {
      const bucket = adminPaymentBucket(team)
      if (bucket === 'paid') paid += 1
      else if (bucket === 'owing') owing += 1
      else other += 1
      if (team.checked_in) checkedIn += 1
      else notCheckedIn += 1
    }
    return { paid, owing, other, checkedIn, notCheckedIn, total: data.teams.length }
  }, [data.teams])

  const filteredTeams = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = data.teams.filter((team) => {
      if (paymentFilter !== 'all' && adminPaymentBucket(team) !== paymentFilter) return false
      if (checkInFilter === 'in' && !team.checked_in) return false
      if (checkInFilter === 'out' && team.checked_in) return false
      if (!needle) return true
      const hay = [
        team.team_name,
        team.payment_status || '',
        ...team.players.map((p) => p.full_name),
        ...team.players.map((p) => p.email),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })

    list.sort((a, b) => {
      if (sort === 'name') return a.team_name.localeCompare(b.team_name)
      const aTs = a.created_at ? new Date(a.created_at).getTime() : 0
      const bTs = b.created_at ? new Date(b.created_at).getTime() : 0
      if (sort === 'oldest') return aTs - bTs || a.team_name.localeCompare(b.team_name)
      return bTs - aTs || a.team_name.localeCompare(b.team_name)
    })
    return list
  }, [data.teams, q, paymentFilter, checkInFilter, sort])

  if (data.teams.length === 0) {
    return (
      <div className="empty-state">
        <p>{includeWithdrawn ? 'No entries found.' : 'No active entries.'}</p>
      </div>
    )
  }

  return (
    <div className="admin-entries">
      <div className="admin-entries-filters">
        <input
          type="search"
          className="admin-entries-search"
          placeholder="Search team, player, or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search entries"
        />
        <div className="admin-entries-filter-row" role="group" aria-label="Payment filter">
          <button
            type="button"
            className={`btn btn-sm ${paymentFilter === 'all' ? 'btn-dark' : 'btn-ghost'}`}
            onClick={() => setPaymentFilter('all')}
          >
            All ({counts.total})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${paymentFilter === 'paid' ? 'btn-dark' : 'btn-ghost'}`}
            onClick={() => setPaymentFilter('paid')}
          >
            Paid ({counts.paid})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${paymentFilter === 'owing' ? 'btn-dark' : 'btn-ghost'}`}
            onClick={() => setPaymentFilter('owing')}
          >
            Not paid ({counts.owing})
          </button>
          {counts.other > 0 && (
            <button
              type="button"
              className={`btn btn-sm ${paymentFilter === 'other' ? 'btn-dark' : 'btn-ghost'}`}
              onClick={() => setPaymentFilter('other')}
            >
              Other ({counts.other})
            </button>
          )}
        </div>
        <div className="admin-entries-filter-row" role="group" aria-label="Check-in filter">
          <button
            type="button"
            className={`btn btn-sm ${checkInFilter === 'all' ? 'btn-dark' : 'btn-ghost'}`}
            onClick={() => setCheckInFilter('all')}
          >
            Any check-in
          </button>
          <button
            type="button"
            className={`btn btn-sm ${checkInFilter === 'in' ? 'btn-dark' : 'btn-ghost'}`}
            onClick={() => setCheckInFilter('in')}
          >
            Checked in ({counts.checkedIn})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${checkInFilter === 'out' ? 'btn-dark' : 'btn-ghost'}`}
            onClick={() => setCheckInFilter('out')}
          >
            Not checked in ({counts.notCheckedIn})
          </button>
        </div>
        <div className="admin-entries-meta-row">
          <label className="admin-check">
            <input
              type="checkbox"
              checked={includeWithdrawn}
              onChange={(e) => onIncludeWithdrawnChange(e.target.checked)}
            />
            Show withdrawn
          </label>
          <label className="admin-entries-sort">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as EntriesSort)}>
              <option value="newest">Newest signup</option>
              <option value="oldest">Oldest signup</option>
              <option value="name">Team name</option>
            </select>
          </label>
        </div>
      </div>

      {filteredTeams.length === 0 ? (
        <div className="empty-state">
          <p>No teams match these filters.</p>
        </div>
      ) : (
        <ul className="admin-entries-list">
          {filteredTeams.map((team) => {
            const signedUp = formatDateTime(team.created_at)
            return (
              <li key={team.team_id} className="admin-entry-row">
                <div>
                  <div className="admin-entry-title-row">
                    <strong>{team.team_name}</strong>
                    {signedUp && <span className="admin-entry-signed-up">{signedUp}</span>}
                  </div>
                  <p>
                    {team.players.map((p) => p.full_name).join(' · ')}
                    {team.payment_status ? ` · ${team.payment_status}` : ''}
                    {team.checked_in ? ' · checked in' : ''}
                    {team.withdrawn ? ' · withdrawn' : ''}
                  </p>
                  <p className="admin-entry-emails">
                    {team.players.map((p) => p.email).join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={team.withdrawn || removeBusy(busyUserId, team.players)}
                  onClick={() => {
                    const first = team.players[0]
                    if (first) onRemove(first.user_id, first.full_name)
                  }}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function removeBusy(
  busyUserId: string | null,
  players: Array<{ user_id: string }>,
): boolean {
  if (!busyUserId) return false
  return players.some((p) => p.user_id === busyUserId)
}

function AdminAccountsPanel({ onToast }: { onToast: (msg: string) => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => window.clearTimeout(t)
  }, [q])

  const { data: users, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-users', debouncedQ],
    queryFn: async () =>
      (await adminApi.listUsers(debouncedQ ? { q: debouncedQ, limit: 100 } : { limit: 100 })).data,
  })

  const detailQuery = useQuery({
    queryKey: ['admin-user', selectedId],
    queryFn: async () => (await adminApi.getUser(selectedId!)).data,
    enabled: !!selectedId,
  })

  const deleteMut = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: (_, userId) => {
      if (selectedId === userId) setSelectedId(null)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.removeQueries({ queryKey: ['admin-user', userId] })
      onToast('Account deleted')
    },
    onError: (e: unknown) => onToast(apiErrorMessage(e, 'Could not delete account')),
  })

  const removeMut = useMutation({
    mutationFn: ({ tournamentId, userId }: { tournamentId: string; userId: string }) =>
      adminApi.removePlayerFromTournament(tournamentId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user', selectedId] })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      onToast('Removed from tournament')
    },
    onError: (e: unknown) => onToast(apiErrorMessage(e, 'Could not remove from tournament')),
  })

  const requestDelete = (u: { id: string; full_name: string; email: string }) => {
    void confirmDialog({
      title: 'Delete account from database?',
      message: `Permanently delete ${u.full_name} (${u.email})? They are removed from the database, withdrawn from active tournaments, and cannot sign in again.`,
      confirmLabel: 'Delete from database',
      danger: true,
    }).then((ok) => {
      if (ok) deleteMut.mutate(u.id)
    })
  }

  return (
    <div className="admin-accounts">
      <p className="muted-note admin-accounts-lead">
        Search anyone on the platform, remove them from tournaments, or delete their account from the database.
      </p>
      <div className="admin-accounts-search">
        <label className="form-label" htmlFor="admin-user-search">
          Search anyone
        </label>
        <input
          id="admin-user-search"
          className="form-input"
          type="search"
          placeholder="Name, email, phone, or student number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      </div>

      {isLoading && (
        <>
          <div className="skeleton" style={{ height: 64, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 64 }} />
        </>
      )}

      {isError && (
        <div className="empty-state">
          <p>Could not load accounts.</p>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (users?.length ?? 0) === 0 && (
        <div className="empty-state">
          <p>{debouncedQ ? 'No accounts match that search.' : 'No accounts yet.'}</p>
        </div>
      )}

      <div className="admin-accounts-layout">
        <ul className="admin-user-list">
          {(users || []).map((u) => (
            <AdminUserRow
              key={u.id}
              user={u}
              selected={selectedId === u.id}
              isSelf={u.id === user?.id}
              onSelect={() => setSelectedId(u.id === selectedId ? null : u.id)}
              onDelete={() => requestDelete(u)}
              deleting={deleteMut.isPending && deleteMut.variables === u.id}
            />
          ))}
        </ul>

        {selectedId && (
          <AdminUserDetailPanel
            detail={detailQuery.data}
            loading={detailQuery.isLoading}
            error={detailQuery.isError}
            onRetry={() => detailQuery.refetch()}
            busyRemove={removeMut.isPending}
            deleting={deleteMut.isPending && deleteMut.variables === selectedId}
            canDelete={!!detailQuery.data && detailQuery.data.id !== user?.id && detailQuery.data.role !== 'ADMIN'}
            onDelete={() => {
              if (detailQuery.data) requestDelete(detailQuery.data)
            }}
            onRemove={(tournamentId, tournamentName) => {
              const name = detailQuery.data?.full_name || 'this player'
              void confirmDialog({
                title: 'Remove from tournament?',
                message: `Withdraw ${name} from "${tournamentName}"?`,
                confirmLabel: 'Remove',
                danger: true,
              }).then((ok) => {
                if (ok) removeMut.mutate({ tournamentId, userId: selectedId })
              })
            }}
          />
        )}
      </div>
    </div>
  )
}

function AdminUserRow({
  user,
  selected,
  isSelf,
  onSelect,
  onDelete,
  deleting,
}: {
  user: AdminUser
  selected: boolean
  isSelf: boolean
  onSelect: () => void
  onDelete: () => void
  deleting: boolean
}) {
  return (
    <li className={`admin-user-row${selected ? ' is-selected' : ''}`}>
      <button type="button" className="admin-user-main" onClick={onSelect}>
        <strong>{user.full_name}</strong>
        <span>{user.email}</span>
        <span className="admin-user-meta">
          {user.university_short || 'No uni'}
          {user.tournament_entries > 0 ? ` · ${user.tournament_entries} active entr${user.tournament_entries === 1 ? 'y' : 'ies'}` : ''}
          {user.role === 'ADMIN' ? ' · Admin' : ''}
          {isSelf ? ' · You' : ''}
        </span>
      </button>
      {!isSelf && user.role !== 'ADMIN' && (
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      )}
    </li>
  )
}

function AdminUserDetailPanel({
  detail,
  loading,
  error,
  onRetry,
  busyRemove,
  deleting,
  canDelete,
  onDelete,
  onRemove,
}: {
  detail: AdminUserDetail | undefined
  loading: boolean
  error: boolean
  onRetry: () => void
  busyRemove: boolean
  deleting: boolean
  canDelete: boolean
  onDelete: () => void
  onRemove: (tournamentId: string, tournamentName: string) => void
}) {
  if (loading) {
    return <div className="admin-user-detail skeleton" style={{ minHeight: 160 }} />
  }
  if (error || !detail) {
    return (
      <div className="admin-user-detail empty-state">
        <p>Could not load account details.</p>
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  const activeEntries = detail.entries.filter((e) => !e.withdrawn)
  const pastEntries = detail.entries.filter((e) => e.withdrawn)

  return (
    <div className="admin-user-detail">
      <h2>{detail.full_name}</h2>
      <p>{detail.email}</p>
      <p className="admin-user-meta">
        {[detail.university_short, detail.phone, detail.student_number].filter(Boolean).join(' · ') || 'No extra details'}
        {!detail.is_active ? ' · Inactive' : ''}
      </p>

      <h3>Tournament entries</h3>
      {activeEntries.length === 0 && pastEntries.length === 0 && (
        <p className="muted-note">Not entered in any tournaments.</p>
      )}
      {activeEntries.length > 0 && (
        <ul className="admin-user-entries">
          {activeEntries.map((e) => (
            <li key={e.team_id}>
              <div>
                <Link to={`/t/${e.tournament_slug}`}>{e.tournament_name}</Link>
                <span>
                  {formatDate(e.event_date, { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
                  {statusLabel(e.tournament_status)}
                  {e.payment_status ? ` · ${e.payment_status}` : ''}
                </span>
                <span>{e.players.join(' · ')}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busyRemove}
                onClick={() => onRemove(e.tournament_id, e.tournament_name)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {pastEntries.length > 0 && (
        <p className="muted-note">
          {pastEntries.length} withdrawn entr{pastEntries.length === 1 ? 'y' : 'ies'} hidden.
        </p>
      )}

      {canDelete && (
        <div className="admin-user-danger">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? 'Deleting…' : 'Delete account from database'}
          </button>
        </div>
      )}
    </div>
  )
}
