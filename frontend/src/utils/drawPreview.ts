/** Client-side draw preview for the organiser generate confirm modal. */

function nextPowerOfTwo(n: number) {
  if (n <= 1) return 1
  return 1 << (32 - Math.clz32(n - 1))
}

function knockoutRoundNames(bracketSize: number): string[] {
  const names: Record<number, string[]> = {
    2: ['FINAL'],
    4: ['SEMI_FINAL', 'FINAL'],
    8: ['QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'],
    16: ['ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'],
    32: ['ROUND_OF_32', 'ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'],
    64: ['ROUND_OF_64', 'ROUND_OF_32', 'ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL'],
  }
  if (names[bracketSize]) return names[bracketSize]
  const rounds: string[] = []
  let size = bracketSize
  while (size > 2) {
    rounds.push(`ROUND_OF_${size}`)
    size = Math.floor(size / 2)
  }
  rounds.push('FINAL')
  return rounds
}

export function balancedGroupSizes(n: number, preferredSize: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [1]
  const preferred = Math.max(2, preferredSize)
  let groupCount = Math.max(1, Math.ceil(n / preferred))
  while (groupCount > 1 && Math.floor(n / groupCount) < 2) {
    groupCount -= 1
  }
  const base = Math.floor(n / groupCount)
  const rem = n % groupCount
  const sizes = Array.from({ length: groupCount }, (_, i) => base + (i < rem ? 1 : 0))
  while (sizes.length > 1 && Math.min(...sizes) < 2) {
    sizes.sort((a, b) => a - b)
    const singleton = sizes.shift()!
    sizes[0] += singleton
  }
  return sizes
}

export type DrawPreview = {
  ok: boolean
  error?: string
  format: string
  teamCount: number
  groupCount: number
  groupSizes: number[]
  groupMatches: number
  advancePerGroup: number
  advanceAdjusted: boolean
  requestedAdvance: number
  advancing: number
  bracketSize: number
  byeSlots: number
  knockoutRounds: string[]
  knockoutMatches: number
  plateRounds: string[]
  plateMatches: number
  enablePlate: boolean
  championshipSize: number
  plateSize: number
  totalMatches: number
  note?: string
}

export function previewDraw(opts: {
  teamCount: number
  groupSize?: number
  teamsAdvancePerGroup?: number
  format?: string
  enablePlate?: boolean
  championshipSize?: number
  plateSize?: number
}): DrawPreview {
  const teamCount = opts.teamCount
  const groupSize = opts.groupSize ?? 4
  const requestedAdvance = opts.teamsAdvancePerGroup ?? 2
  const format = opts.format || 'GROUP_KNOCKOUT'
  const enablePlate = !!opts.enablePlate
  const championshipSize = opts.championshipSize ?? 16
  const plateSize = opts.plateSize ?? 16

  const empty = (partial: Partial<DrawPreview>): DrawPreview => ({
    ok: false,
    format,
    teamCount,
    groupCount: 0,
    groupSizes: [],
    groupMatches: 0,
    advancePerGroup: 0,
    advanceAdjusted: false,
    requestedAdvance,
    advancing: 0,
    bracketSize: 0,
    byeSlots: 0,
    knockoutRounds: [],
    knockoutMatches: 0,
    plateRounds: [],
    plateMatches: 0,
    enablePlate,
    championshipSize: 0,
    plateSize: 0,
    totalMatches: 0,
    ...partial,
  })

  if (teamCount < 2) {
    return empty({ error: 'Need at least 2 paid entries to generate' })
  }

  if (format === 'ROUND_ROBIN') {
    const groupMatches = (teamCount * (teamCount - 1)) / 2
    return {
      ok: true,
      format,
      teamCount,
      groupCount: 1,
      groupSizes: [teamCount],
      groupMatches,
      advancePerGroup: 0,
      advanceAdjusted: false,
      requestedAdvance: 0,
      advancing: 0,
      bracketSize: 0,
      byeSlots: 0,
      knockoutRounds: [],
      knockoutMatches: 0,
      plateRounds: [],
      plateMatches: 0,
      enablePlate: false,
      championshipSize: 0,
      plateSize: 0,
      totalMatches: groupMatches,
    }
  }

  const groupSizes = balancedGroupSizes(teamCount, groupSize)
  const groupMatches = groupSizes.reduce((sum, s) => sum + (s * (s - 1)) / 2, 0)

  if (enablePlate) {
    const champ = nextPowerOfTwo(Math.max(2, championshipSize))
    const plate = nextPowerOfTwo(Math.max(2, plateSize))
    const needed = champ + plate
    if (needed > teamCount) {
      return empty({
        error: `Championship (${champ}) + Plate (${plate}) need ${needed} teams, but only ${teamCount} are entered`,
        groupCount: groupSizes.length,
        groupSizes,
        groupMatches,
        enablePlate: true,
      })
    }
    const knockoutRounds = knockoutRoundNames(champ)
    const plateRounds = knockoutRoundNames(plate)
    const knockoutMatches = champ - 1
    const plateMatches = plate - 1
    return {
      ok: true,
      format,
      teamCount,
      groupCount: groupSizes.length,
      groupSizes,
      groupMatches,
      advancePerGroup: 0,
      advanceAdjusted: false,
      requestedAdvance: 0,
      advancing: needed,
      bracketSize: champ,
      byeSlots: 0,
      knockoutRounds,
      knockoutMatches,
      plateRounds,
      plateMatches,
      enablePlate: true,
      championshipSize: champ,
      plateSize: plate,
      totalMatches: groupMatches + knockoutMatches + plateMatches,
      note: `${champ} → Championship · ${plate} → Plate`,
    }
  }

  const minSize = groupSizes.length ? Math.min(...groupSizes) : 0
  const advancePerGroup = Math.min(Math.max(1, requestedAdvance), minSize)
  const advanceAdjusted = advancePerGroup !== requestedAdvance
  const advancing = groupSizes.length * advancePerGroup

  if (advancing < 2) {
    return {
      ok: true,
      format,
      teamCount,
      groupCount: groupSizes.length,
      groupSizes,
      groupMatches,
      advancePerGroup,
      advanceAdjusted,
      requestedAdvance,
      advancing,
      bracketSize: 0,
      byeSlots: 0,
      knockoutRounds: [],
      knockoutMatches: 0,
      plateRounds: [],
      plateMatches: 0,
      enablePlate: false,
      championshipSize: 0,
      plateSize: 0,
      totalMatches: groupMatches,
      note: 'Group stage only - not enough advancers for a knockout.',
    }
  }

  const bracketSize = nextPowerOfTwo(advancing)
  const byeSlots = bracketSize - advancing
  const knockoutRounds = knockoutRoundNames(bracketSize)
  const knockoutMatches = bracketSize - 1

  return {
    ok: true,
    format,
    teamCount,
    groupCount: groupSizes.length,
    groupSizes,
    groupMatches,
    advancePerGroup,
    advanceAdjusted,
    requestedAdvance,
    advancing,
    bracketSize,
    byeSlots,
    knockoutRounds,
    knockoutMatches,
    plateRounds: [],
    plateMatches: 0,
    enablePlate: false,
    championshipSize: 0,
    plateSize: 0,
    totalMatches: groupMatches + knockoutMatches,
  }
}

export function formatGroupSizes(sizes: number[]): string {
  if (sizes.length === 0) return '-'
  const counts = new Map<number, number>()
  for (const s of sizes) counts.set(s, (counts.get(s) || 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, n]) => (n === 1 ? `${size}` : `${n}×${size}`))
    .join(' + ')
}

export function knockoutRoundLabel(round: string): string {
  const map: Record<string, string> = {
    FINAL: 'Final',
    SEMI_FINAL: 'Semi-finals',
    QUARTER_FINAL: 'Quarter-finals',
    ROUND_OF_16: 'Round of 16',
    ROUND_OF_32: 'Round of 32',
    ROUND_OF_64: 'Round of 64',
  }
  return map[round] || round.replace(/_/g, ' ').toLowerCase()
}
