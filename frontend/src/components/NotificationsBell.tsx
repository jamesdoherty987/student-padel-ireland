import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  apiErrorMessage,
  communityApi,
  type NotificationItem,
} from '../services/api'

const SEEN_KEY = 'spi-notif-seen'

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveSeen(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200)))
  } catch {
    /* ignore */
  }
}

function kindLabel(kind: string) {
  if (kind === 'friend_request' || kind === 'friend_accepted') return 'Friends'
  if (kind === 'match_confirm' || kind === 'match_score') return 'Action needed'
  if (kind === 'upcoming') return 'Upcoming'
  if (kind === 'match_result') return 'Results'
  return 'Updates'
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.round((Date.now() - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 14) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function NotificationsBell() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen())
  const [error, setError] = useState('')

  const feedQ = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await communityApi.notifications()).data,
    staleTime: 45_000,
    refetchInterval: open ? 60_000 : false,
  })

  const items = feedQ.data?.items || []
  const actionableCount = feedQ.data?.actionable_count || 0

  const unseenInfo = useMemo(
    () => items.filter((n) => !n.actionable && !seen.has(n.id)).length,
    [items, seen],
  )
  const badgeCount = actionableCount + unseenInfo

  const refreshNotifs = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] })
    qc.invalidateQueries({ queryKey: ['friends'] })
    qc.invalidateQueries({ queryKey: ['community-home'] })
  }

  const acceptMut = useMutation({
    mutationFn: (id: string) => communityApi.acceptFriend(id),
    onSuccess: () => {
      setError('')
      refreshNotifs()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const declineMut = useMutation({
    mutationFn: (id: string) => communityApi.removeFriend(id),
    onSuccess: () => {
      setError('')
      refreshNotifs()
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })
  const confirmMut = useMutation({
    mutationFn: (id: string) => communityApi.confirmMatch(id),
    onSuccess: () => {
      setError('')
      refreshNotifs()
      qc.invalidateQueries({ queryKey: ['rankings'] })
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const markInfoSeen = () => {
    if (items.length === 0) return
    setSeen((prev) => {
      const next = new Set(prev)
      for (const n of items) {
        if (!n.actionable) next.add(n.id)
      }
      saveSeen(next)
      return next
    })
  }

  const closePanel = () => {
    markInfoSeen()
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const markAndClose = () => {
      setSeen((prev) => {
        const next = new Set(prev)
        for (const n of items) {
          if (!n.actionable) next.add(n.id)
        }
        saveSeen(next)
        return next
      })
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') markAndClose()
    }
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        markAndClose()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open, items])

  const grouped = useMemo(() => {
    const order = ['friend_request', 'match_confirm', 'match_score', 'upcoming', 'friend_accepted', 'match_result']
    const map = new Map<string, NotificationItem[]>()
    for (const n of items) {
      const key = kindLabel(n.kind)
      const list = map.get(key) || []
      list.push(n)
      map.set(key, list)
    }
    const sections: { label: string; items: NotificationItem[] }[] = []
    const seenLabels = new Set<string>()
    for (const kind of order) {
      const label = kindLabel(kind)
      if (seenLabels.has(label)) continue
      const list = map.get(label)
      if (list?.length) {
        sections.push({ label, items: list })
        seenLabels.add(label)
      }
    }
    return sections
  }, [items])

  const openItem = (n: NotificationItem) => {
    markInfoSeen()
    setOpen(false)
    navigate(n.href)
  }

  return (
    <div className={`notif-root ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`notif-bell ${open ? 'is-open' : ''}`}
        aria-label={badgeCount > 0 ? `Notifications, ${badgeCount} new` : 'Notifications'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setError('')
          if (open) closePanel()
          else setOpen(true)
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
          <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
        </svg>
        {badgeCount > 0 && (
          <span className="nav-badge notif-badge" aria-hidden>
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-panel" id={panelId} role="dialog" aria-label="Notifications">
          <div className="notif-panel-head">
            <h2>Notifications</h2>
            <button type="button" className="notif-close" aria-label="Close" onClick={closePanel}>
              ×
            </button>
          </div>

          {error && <p className="form-error notif-error">{error}</p>}

          {feedQ.isLoading && (
            <div className="notif-empty">
              <div className="skeleton" style={{ height: 48, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 48 }} />
            </div>
          )}

          {!feedQ.isLoading && items.length === 0 && (
            <div className="notif-empty">
              <p>No new notifications</p>
              {feedQ.isError && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => feedQ.refetch()}>
                  Refresh
                </button>
              )}
            </div>
          )}

          {!feedQ.isLoading && grouped.length > 0 && (
            <div className="notif-list">
              {grouped.map((section) => (
                <section key={section.label} className="notif-section">
                  <h3>{section.label}</h3>
                  <ul>
                    {section.items.map((n) => {
                      const isNew = n.actionable || !seen.has(n.id)
                      return (
                        <li
                          key={n.id}
                          className={`notif-item ${isNew ? 'is-new' : ''} ${n.actionable ? 'is-action' : ''}`}
                        >
                          <button type="button" className="notif-item-main" onClick={() => openItem(n)}>
                            <strong>{n.title}</strong>
                            <span>{n.body}</span>
                            <em>{timeAgo(n.created_at)}</em>
                          </button>
                          {n.kind === 'friend_request' && n.friendship_id && (
                            <div className="notif-item-actions">
                              <button
                                type="button"
                                className="btn btn-dark btn-xs"
                                disabled={acceptMut.isPending || declineMut.isPending}
                                onClick={() => acceptMut.mutate(n.friendship_id!)}
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                disabled={acceptMut.isPending || declineMut.isPending}
                                onClick={() => declineMut.mutate(n.friendship_id!)}
                              >
                                Decline
                              </button>
                            </div>
                          )}
                          {n.kind === 'match_confirm' && n.match_id && (
                            <div className="notif-item-actions">
                              <button
                                type="button"
                                className="btn btn-dark btn-xs"
                                disabled={confirmMut.isPending}
                                onClick={() => confirmMut.mutate(n.match_id!)}
                              >
                                Confirm
                              </button>
                              <Link to={n.href} className="btn btn-ghost btn-xs" onClick={closePanel}>
                                Open
                              </Link>
                            </div>
                          )}
                          {n.kind === 'match_score' && (
                            <div className="notif-item-actions">
                              <Link to={n.href} className="btn btn-dark btn-xs" onClick={closePanel}>
                                Enter score
                              </Link>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
