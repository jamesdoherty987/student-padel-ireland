/** Organiser-set team gender for draw placement. */
export type TeamGender = 'M' | 'F' | 'X'

export const TEAM_GENDER_OPTIONS: { value: '' | TeamGender; label: string }[] = [
  { value: '', label: 'Not set' },
  { value: 'M', label: 'Men' },
  { value: 'F', label: 'Women' },
  { value: 'X', label: 'Mixed' },
]

/** Compact labels for dense entry rows */
export const TEAM_GENDER_ROW_OPTIONS: { value: '' | TeamGender; label: string }[] = [
  { value: '', label: 'Gender' },
  { value: 'M', label: 'Men' },
  { value: 'F', label: 'Women' },
  { value: 'X', label: 'Mixed' },
]

export function normalizeTeamGender(raw?: string | null): TeamGender | '' {
  const g = (raw || '').trim().toUpperCase()
  if (g === 'M' || g === 'F' || g === 'X') return g
  return ''
}

export function teamGenderLabel(raw?: string | null): string {
  const g = normalizeTeamGender(raw)
  if (g === 'M') return 'Men'
  if (g === 'F') return 'Women'
  if (g === 'X') return 'Mixed'
  return ''
}

export function teamGenderShort(raw?: string | null): string {
  const g = normalizeTeamGender(raw)
  if (g === 'M') return 'Men'
  if (g === 'F') return 'Women'
  if (g === 'X') return 'Mixed'
  return ''
}

export function countTeamGenders(
  teams: Array<{ gender?: string | null; withdrawn?: boolean }>,
): { men: number; women: number; mixed: number; unset: number } {
  let men = 0
  let women = 0
  let mixed = 0
  let unset = 0
  for (const t of teams) {
    if (t.withdrawn) continue
    const g = normalizeTeamGender(t.gender)
    if (g === 'M') men += 1
    else if (g === 'F') women += 1
    else if (g === 'X') mixed += 1
    else unset += 1
  }
  return { men, women, mixed, unset }
}

export function formatGenderCounts(counts: {
  men: number
  women: number
  mixed: number
  unset: number
}): string {
  const parts: string[] = []
  if (counts.men) parts.push(`${counts.men} men`)
  if (counts.women) parts.push(`${counts.women} women`)
  if (counts.mixed) parts.push(`${counts.mixed} mixed`)
  if (counts.unset) parts.push(`${counts.unset} not set`)
  return parts.join(' · ')
}
