/** Client-side group placement helpers for the generate-draw UI. */

import { balancedGroupSizes } from './drawPreview'

export type SeedingMode = 'alphabetical' | 'random' | 'university_spread' | 'manual'

export type SeedableTeam = {
  id: string
  name: string
  university_id?: string | null
  university_short?: string | null
}

export const SEEDING_MODE_OPTIONS: { value: SeedingMode; label: string; hint: string }[] = [
  {
    value: 'alphabetical',
    label: 'Alphabetical',
    hint: 'Snake-seed A–Z by team name',
  },
  {
    value: 'random',
    label: 'Random',
    hint: 'Shuffle entries, then fill groups evenly',
  },
  {
    value: 'university_spread',
    label: 'Spread universities',
    hint: 'Keep same-university teams apart when possible',
  },
  {
    value: 'manual',
    label: 'Manual',
    hint: 'Start empty and place every team yourself',
  },
]

export function groupLetter(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function uniKey(team: SeedableTeam): string {
  return (team.university_id || team.university_short || `solo:${team.id}`).toLowerCase()
}

function orderTeams(teams: SeedableTeam[], mode: SeedingMode, randomSeed: number): SeedableTeam[] {
  if (mode === 'random') return shuffle(teams, randomSeed)
  if (mode === 'university_spread') {
    const counts = new Map<string, number>()
    for (const t of teams) counts.set(uniKey(t), (counts.get(uniKey(t)) || 0) + 1)
    return [...teams].sort((a, b) => {
      const ca = counts.get(uniKey(a)) || 0
      const cb = counts.get(uniKey(b)) || 0
      if (cb !== ca) return cb - ca
      const ua = (a.university_short || '').localeCompare(b.university_short || '')
      if (ua) return ua
      return a.name.localeCompare(b.name)
    })
  }
  return [...teams].sort((a, b) => a.name.localeCompare(b.name))
}

function snakeFill(ordered: SeedableTeam[], sizes: number[]): SeedableTeam[][] {
  if (!sizes.length) return []
  const groups: SeedableTeam[][] = sizes.map(() => [])
  let direction = 1
  let g = 0
  for (const team of ordered) {
    let placed = false
    for (let attempt = 0; attempt < sizes.length * 2; attempt += 1) {
      if (groups[g].length < sizes[g]) {
        groups[g].push(team)
        placed = true
        break
      }
      if (direction === 1 && g === sizes.length - 1) direction = -1
      else if (direction === -1 && g === 0) direction = 1
      else g += direction
      g = Math.max(0, Math.min(sizes.length - 1, g))
    }
    if (!placed) {
      let best = 0
      let bestRoom = -Infinity
      for (let i = 0; i < sizes.length; i += 1) {
        const room = sizes[i] - groups[i].length
        if (room > bestRoom) {
          bestRoom = room
          best = i
        }
      }
      groups[best].push(team)
      g = best
    }
    if (direction === 1 && g === sizes.length - 1) direction = -1
    else if (direction === -1 && g === 0) direction = 1
    else g += direction
    g = Math.max(0, Math.min(sizes.length - 1, g))
  }
  return groups.filter((grp) => grp.length > 0)
}

function universitySpread(teams: SeedableTeam[], groupSize: number): SeedableTeam[][] {
  const ordered = orderTeams(teams, 'university_spread', 0)
  const sizes = balancedGroupSizes(ordered.length, groupSize)
  if (!sizes.length) return []
  const groups: SeedableTeam[][] = sizes.map(() => [])
  const uniCounts: Map<string, number>[] = sizes.map(() => new Map())

  for (const team of ordered) {
    const key = uniKey(team)
    const candidates = sizes
      .map((_, i) => i)
      .filter((i) => groups[i].length < sizes[i])
    let idx: number
    if (!candidates.length) {
      idx = sizes
        .map((size, i) => ({ i, room: size - groups[i].length }))
        .sort((a, b) => b.room - a.room)[0].i
    } else {
      idx = [...candidates].sort((a, b) => {
        const ua = uniCounts[a].get(key) || 0
        const ub = uniCounts[b].get(key) || 0
        if (ua !== ub) return ua - ub
        if (groups[a].length !== groups[b].length) return groups[a].length - groups[b].length
        return a - b
      })[0]
    }
    groups[idx].push(team)
    uniCounts[idx].set(key, (uniCounts[idx].get(key) || 0) + 1)
  }
  return groups.filter((grp) => grp.length > 0)
}

/** Build group id lists for a seeding mode. Manual returns empty groups + all unassigned. */
export function buildGroupAssignment(
  teams: SeedableTeam[],
  mode: SeedingMode,
  groupSize: number,
  randomSeed = Date.now(),
): { groups: string[][]; unassigned: string[] } {
  if (teams.length < 2) {
    return { groups: [], unassigned: teams.map((t) => t.id) }
  }
  if (mode === 'manual') {
    const sizes = balancedGroupSizes(teams.length, groupSize)
    return {
      groups: sizes.map(() => []),
      unassigned: teams.map((t) => t.id),
    }
  }
  if (mode === 'university_spread') {
    return {
      groups: universitySpread(teams, groupSize).map((g) => g.map((t) => t.id)),
      unassigned: [],
    }
  }
  const ordered = orderTeams(teams, mode, randomSeed)
  const sizes = balancedGroupSizes(ordered.length, groupSize)
  return {
    groups: snakeFill(ordered, sizes).map((g) => g.map((t) => t.id)),
    unassigned: [],
  }
}

export function validateGroupAssignment(
  teamIds: string[],
  groups: string[][],
  unassigned: string[],
): string | null {
  if (unassigned.length > 0) {
    return `${unassigned.length} entr${unassigned.length === 1 ? 'y is' : 'ies are'} still unassigned`
  }
  const flat = groups.flat()
  if (flat.length !== teamIds.length) {
    return 'Group assignment does not match the paid field'
  }
  if (new Set(flat).size !== flat.length) {
    return 'A team appears in more than one group'
  }
  const expected = new Set(teamIds)
  for (const id of flat) {
    if (!expected.has(id)) return 'Group assignment includes an unknown team'
  }
  for (const id of teamIds) {
    if (!flat.includes(id)) return 'Every paid entry must be in a group'
  }
  const nonEmpty = groups.filter((g) => g.length > 0)
  if (nonEmpty.length < 1) return 'Add at least one group'
  if (nonEmpty.length >= 2 && nonEmpty.some((g) => g.length < 2)) {
    return 'Merge singleton groups - every group needs at least 2 entries'
  }
  return null
}
