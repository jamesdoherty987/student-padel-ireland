/** Shared UI helpers */

export function formatMoney(cents: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100)
  } catch {
    return `€${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
  }
}

/** Entry fee is stored per entry (player for singles, team for doubles); returns the per-player amount in cents. */
export function perPlayerFeeCents(entryFeeCents: number, playFormat: string = 'DOUBLES') {
  return playFormat === 'SINGLES' ? entryFeeCents : entryFeeCents / 2
}

/** e.g. "€25/player" */
export function formatPerPlayerFee(entryFeeCents: number, currency = 'EUR', playFormat: string = 'DOUBLES') {
  return `${formatMoney(Math.round(perPlayerFeeCents(entryFeeCents, playFormat)), currency)}/player`
}

/** e.g. "12/48 teams · €35/player" — works for singles & doubles (always per player) */
export function formatEntrySummary(
  registered: number,
  maxTeams: number,
  entryFeeCents: number,
  currency = 'EUR',
  playFormat: string = 'DOUBLES',
) {
  const spots = playFormat === 'SINGLES' ? 'singles spots' : 'doubles spots'
  const fee = formatPerPlayerFee(entryFeeCents, currency, playFormat)
  if (registered <= 0) {
    return `${fee} · ${maxTeams} ${spots}`
  }
  const noun = playFormat === 'SINGLES' ? 'singles' : 'doubles'
  return `${registered}/${maxTeams} ${noun} · ${fee}`
}

/** @deprecated use formatEntrySummary */
export function formatDoublesEntry(
  registered: number,
  maxTeams: number,
  entryFeeCents: number,
  currency = 'EUR',
) {
  return formatEntrySummary(registered, maxTeams, entryFeeCents, currency, 'DOUBLES')
}

export function spotsLeftLabel(registered: number, maxTeams: number, playFormat: string = 'DOUBLES') {
  const left = Math.max(0, maxTeams - registered)
  if (left === 0) return 'Full'
  const noun = playFormat === 'SINGLES' ? 'singles spot' : 'doubles spot'
  if (left === 1) return `1 ${noun} left`
  return `${left} ${noun}s left`
}

export function courtLabel(courtName?: string | null, courtNumber?: number | null) {
  if (courtName) return courtName
  if (courtNumber != null) return `Court ${courtNumber}`
  return 'Court TBC'
}

export function playFormatLabel(playFormat?: string | null) {
  return playFormat === 'SINGLES' ? 'Singles' : 'Doubles'
}

export function bracketFormatLabel(format?: string | null) {
  switch (format) {
    case 'ROUND_ROBIN':
      return 'Round robin'
    case 'STRAIGHT_KNOCKOUT':
      return 'Knockout'
    case 'SWISS':
      return 'Swiss'
    case 'GROUP_KNOCKOUT':
    default:
      return 'Groups then knockout'
  }
}

/** Short line for players: "Doubles · Groups then knockout" */
export function tournamentFormatSummary(playFormat?: string | null, format?: string | null) {
  return `${playFormatLabel(playFormat)} · ${bracketFormatLabel(format)}`
}

export function playFormatHint(playFormat?: string | null) {
  if (playFormat === 'SINGLES') {
    return '1v1 entries. Each player registers and pays their own fee.'
  }
  return 'Register as a pair. One team fee covers both players.'
}

export function bracketFormatHint(format?: string | null) {
  if (format === 'ROUND_ROBIN') {
    return 'Everyone plays everyone in the draw. Standings decide the winner — no knockout stage.'
  }
  return 'Split into groups first. Top finishers from each group advance to a knockout bracket.'
}

export function parseCalendarDate(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  return new Date(iso)
}

export function isPastCalendarDate(iso: string | null | undefined) {
  if (!iso) return false
  // Prefer full datetime when present (registration deadlines include time)
  if (iso.includes('T') || /Z$|[+-]\d{2}:\d{2}$/.test(iso)) {
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) return Date.now() > d.getTime()
  }
  const d = parseCalendarDate(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today > d
}

/** Format an ISO datetime for `<input type="datetime-local">` in local time. */
export function toDatetimeLocalValue(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    // Already local-ish (YYYY-MM-DDTHH:mm)
    return iso.slice(0, 16)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions) {
  return parseCalendarDate(iso).toLocaleDateString('en-IE', opts ?? { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return 'TBC'
  // Backend may send "10:00:00" or full ISO
  if (/^\d{2}:\d{2}/.test(iso) && !iso.includes('T')) {
    return iso.slice(0, 5)
  }
  return new Date(iso).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    REGISTRATION_OPEN: 'Open',
    REGISTRATION_CLOSED: 'Closed',
    LIVE: 'Live',
    COMPLETED: 'Past',
    CANCELLED: 'Cancelled',
    OPEN: 'Open',
    SCHEDULED: 'Scheduled',
    CALLED: 'Called',
    AWAITING_CONFIRM: 'Awaiting confirm',
    WALKOVER: 'Walkover',
  }
  if (labels[status]) return labels[status]
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function statusBadgeClass(status: string) {
  if (status === 'LIVE' || status === 'CALLED') return 'badge-live'
  if (status === 'COMPLETED') return 'badge-past'
  if (status === 'REGISTRATION_OPEN' || status === 'OPEN' || status === 'PAID') {
    return 'badge-open'
  }
  if (status === 'CANCELLED') return 'badge-draft'
  return 'badge-draft'
}

export function currentSetScores(score: {
  set1_a: number
  set1_b: number
  set2_a: number
  set2_b: number
  set3_a: number
  set3_b: number
  current_set: number
} | null | undefined) {
  if (!score) return { a: 0, b: 0, set: 1 }
  const set = Math.min(3, Math.max(1, score.current_set || 1))
  const keyA = `set${set}_a` as 'set1_a' | 'set2_a' | 'set3_a'
  const keyB = `set${set}_b` as 'set1_b' | 'set2_b' | 'set3_b'
  return { a: score[keyA] ?? 0, b: score[keyB] ?? 0, set }
}

export function formatMatchScore(score: {
  set1_a: number
  set1_b: number
  set2_a: number
  set2_b: number
  set3_a: number
  set3_b: number
} | null | undefined) {
  if (!score) return '-'
  const parts = [`${score.set1_a}-${score.set1_b}`]
  if (score.set2_a || score.set2_b) parts.push(`${score.set2_a}-${score.set2_b}`)
  if (score.set3_a || score.set3_b) parts.push(`${score.set3_a}-${score.set3_b}`)
  return parts.join('  ')
}

/** Live board line: current-set games first, full sets as secondary. */
export function formatLiveBoardScore(score: {
  set1_a: number
  set1_b: number
  set2_a: number
  set2_b: number
  set3_a: number
  set3_b: number
  current_set: number
} | null | undefined) {
  const cur = currentSetScores(score)
  const sets = formatMatchScore(score)
  return {
    games: `${cur.a}-${cur.b}`,
    set: cur.set,
    sets: sets === '-' ? '' : sets,
  }
}
