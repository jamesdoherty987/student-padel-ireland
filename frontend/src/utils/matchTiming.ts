import type { Match } from '../services/api'

/** Show “up next” boards this many ms before tip-off. */
export const IMMINENT_BEFORE_MS = 15 * 60 * 1000
/** Keep overdue SCHEDULED on the board this long after tip-off. */
export const IMMINENT_OVERDUE_MS = 60 * 60 * 1000

export function matchStartMs(m: Pick<Match, 'scheduled_start'> | { scheduled_start?: string | null }) {
  if (!m.scheduled_start) return null
  // Bare HH:MM has no date — can't judge imminence
  if (/^\d{2}:\d{2}/.test(m.scheduled_start) && !m.scheduled_start.includes('T')) return null
  const t = new Date(m.scheduled_start).getTime()
  return Number.isNaN(t) ? null : t
}

/** SCHEDULED match that should appear on a “now / up next” court board. */
export function isImminentScheduled(
  m: Pick<Match, 'status' | 'scheduled_start'>,
  nowMs = Date.now(),
  opts?: { beforeMs?: number; overdueMs?: number },
) {
  if (m.status !== 'SCHEDULED') return false
  const start = matchStartMs(m)
  if (start == null) return false
  const beforeMs = opts?.beforeMs ?? IMMINENT_BEFORE_MS
  const overdueMs = opts?.overdueMs ?? IMMINENT_OVERDUE_MS
  return start - nowMs <= beforeMs && start >= nowMs - overdueMs
}

export function isActiveOnCourt(status: string) {
  return status === 'LIVE' || status === 'CALLED' || status === 'AWAITING_CONFIRM'
}

/** LIVE / CALLED / confirm, or SCHEDULED within the imminent window. */
export function isCourtsideRelevant(
  m: Pick<Match, 'status' | 'scheduled_start'>,
  nowMs = Date.now(),
) {
  return isActiveOnCourt(m.status) || isImminentScheduled(m, nowMs)
}

export function sortByScheduledStart(a: Match, b: Match) {
  const ta = matchStartMs(a) ?? Number.MAX_SAFE_INTEGER
  const tb = matchStartMs(b) ?? Number.MAX_SAFE_INTEGER
  if (ta !== tb) return ta - tb
  return (a.sort_order || 0) - (b.sort_order || 0)
}

/** Same local calendar day as now (for “Later today” copy). */
export function isSameLocalDay(iso: string | null | undefined, nowMs = Date.now()) {
  const start = iso ? matchStartMs({ scheduled_start: iso }) : null
  if (start == null) return false
  const a = new Date(start)
  const b = new Date(nowMs)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
