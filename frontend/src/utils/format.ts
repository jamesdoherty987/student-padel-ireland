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

/** Total charged via Stripe Checkout (entry + platform service fee). */
export function onlineTotalCents(entryFeeCents: number, serviceFeeCents = 0) {
  const entry = Math.max(0, entryFeeCents)
  if (entry <= 0) return 0
  return entry + Math.max(0, serviceFeeCents)
}

/** Compact total for buttons, e.g. "€16.50". */
export function formatOnlineTotal(
  entryFeeCents: number,
  serviceFeeCents = 0,
  currency = 'EUR',
) {
  return formatMoney(onlineTotalCents(entryFeeCents, serviceFeeCents), currency)
}

/** Prose breakdown, e.g. "€15 + €1.50 service fee" (or just "€15" when fee is 0). */
export function formatOnlineFee(
  entryFeeCents: number,
  serviceFeeCents = 0,
  currency = 'EUR',
) {
  const base = formatMoney(entryFeeCents, currency)
  if (serviceFeeCents <= 0 || entryFeeCents <= 0) return base
  return `${base} + ${formatMoney(serviceFeeCents, currency)} service fee`
}

/** e.g. "12/48 teams · €35/player" - works for singles & doubles (always per player) */
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

export function bracketFormatHint(format?: string | null, enablePlate?: boolean) {
  if (format === 'ROUND_ROBIN') {
    return 'Everyone plays everyone in the draw. Standings decide the winner - no knockout stage.'
  }
  if (enablePlate) {
    return 'Groups first, then a Championship knockout for the top finishers and a Plate knockout for the next tier.'
  }
  return 'Split into groups first. Top finishers from each group advance to a knockout bracket.'
}

/** Display label for knockout / group round codes from the API. */
export function knockoutRoundLabel(round: string, stage?: string) {
  if (!round) {
    if (stage === 'PLATE') return 'Plate'
    if (stage === 'KNOCKOUT') return 'Championship'
    return 'Match'
  }
  if (round.startsWith('GROUP_')) return `Group ${round.replace('GROUP_', '')}`
  const map: Record<string, string> = {
    ROUND_OF_64: 'Round of 64',
    ROUND_OF_32: 'Round of 32',
    ROUND_OF_16: 'Round of 16',
    R16: 'Round of 16',
    QUARTER_FINAL: 'Quarter-final',
    QF: 'Quarter-final',
    SEMI_FINAL: 'Semi-final',
    SF: 'Semi-final',
    FINAL: 'Final',
    BRONZE: '3rd place',
  }
  const base = map[round] || round.replace(/_/g, ' ')
  return stage === 'PLATE' ? `Plate ${base}` : base
}

/** Sort key for knockout rounds (earlier rounds first). */
export function knockoutRoundOrder(round: string) {
  const order: Record<string, number> = {
    ROUND_OF_64: 10,
    ROUND_OF_32: 20,
    ROUND_OF_16: 30,
    R16: 30,
    QUARTER_FINAL: 40,
    QF: 40,
    SEMI_FINAL: 50,
    SF: 50,
    FINAL: 60,
    BRONZE: 70,
  }
  if (order[round] != null) return order[round]
  const m = round.match(/^ROUND_OF_(\d+)$/)
  if (m) return 1000 - Number(m[1])
  return 500
}

/** True once knockout / plate has real teams or results (not just empty placeholders). */
export function isKnockoutActive(
  matches: Array<{
    stage: string
    team_a_id?: string | null
    team_b_id?: string | null
    status: string
  }>,
) {
  const ko = matches.filter((m) => m.stage === 'KNOCKOUT' || m.stage === 'PLATE')
  if (!ko.length) return false
  return ko.some(
    (m) =>
      !!m.team_a_id ||
      !!m.team_b_id ||
      m.status === 'LIVE' ||
      m.status === 'CALLED' ||
      m.status === 'COMPLETED' ||
      m.status === 'WALKOVER' ||
      m.status === 'AWAITING_CONFIRM',
  )
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

/** Whole calendar days from local today to a YYYY-MM-DD (or datetime) date. */
export function calendarDaysFromToday(iso: string | null | undefined) {
  if (!iso) return null
  const d = parseCalendarDate(iso)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

/** Short copy for the automatic day-before reminder (empty if not relevant). */
export function reminderPromiseCopy(eventDate: string | null | undefined) {
  const days = calendarDaysFromToday(eventDate)
  if (days == null || days < 1) return ''
  if (days === 1) return 'Watch for a reminder email today with a login link.'
  return 'We’ll email you the day before with a login link.'
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

/** Relative cue for a scheduled start, e.g. "in 25 min" / "about now". Null if unknown. */
export function formatRelativeStart(iso: string | null | undefined, nowMs = Date.now()): string | null {
  if (!iso) return null
  // Bare clock times need the event date - skip relative copy
  if (/^\d{2}:\d{2}/.test(iso) && !iso.includes('T') && !iso.includes(' ')) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const diffMin = Math.round((t - nowMs) / 60000)
  if (diffMin <= -45) return null
  if (diffMin <= 2) return 'about now'
  if (diffMin < 60) return `in ${diffMin} min`
  const hours = Math.floor(diffMin / 60)
  const mins = diffMin % 60
  if (hours >= 12) return null
  if (mins === 0) return `in ${hours}h`
  return `in ${hours}h ${mins}m`
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
  if (status === 'LIVE' || status === 'CALLED' || status === 'AWAITING_CONFIRM') return 'badge-live'
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
