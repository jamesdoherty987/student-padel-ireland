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

/** e.g. "12/48 doubles · €50/team" or when empty "€50/team · 48 doubles spots" */
export function formatDoublesEntry(
  registered: number,
  maxTeams: number,
  entryFeeCents: number,
  currency = 'EUR',
) {
  const fee = `${formatMoney(entryFeeCents, currency)}/team`
  if (registered <= 0) {
    return `${fee} · ${maxTeams} doubles spots`
  }
  return `${registered}/${maxTeams} doubles · ${fee}`
}

export function spotsLeftLabel(registered: number, maxTeams: number) {
  const left = Math.max(0, maxTeams - registered)
  if (left === 0) return 'Full'
  if (left === 1) return '1 doubles spot left'
  return `${left} doubles spots left`
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
  const d = parseCalendarDate(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today > d
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
  return status.replace(/_/g, ' ')
}

export function statusBadgeClass(status: string) {
  if (status === 'LIVE') return 'badge-live'
  if (status === 'REGISTRATION_OPEN' || status === 'PAID' || status === 'COMPLETED') return 'badge-open'
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
  if (!score) return '—'
  const parts = [`${score.set1_a}–${score.set1_b}`]
  if (score.set2_a || score.set2_b) parts.push(`${score.set2_a}–${score.set2_b}`)
  if (score.set3_a || score.set3_b) parts.push(`${score.set3_a}–${score.set3_b}`)
  return parts.join('  ')
}
