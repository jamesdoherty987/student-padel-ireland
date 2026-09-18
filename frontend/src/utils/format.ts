/** Shared UI helpers */

export function formatMoney(cents: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
      cents / 100,
    )
  } catch {
    return `€${(cents / 100).toFixed(0)}`
  }
}

export function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString('en-IE', opts ?? { day: 'numeric', month: 'short', year: 'numeric' })
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
