/** Where a group-table team is projected to go after groups. */

export type QualPath = 'cup' | 'shield' | 'qualify' | 'out'

export type StandingGroup = {
  group: string
  standings: Array<{ team_id: string }>
}

export type QualTournamentOpts = {
  format?: string | null
  enablePlate?: boolean | null
  championshipSize?: number | null
  plateSize?: number | null
  teamsAdvancePerGroup?: number | null
}

/** Flatten standings: all 1sts (group order), then 2nds, then 3rds… */
export function orderedGroupQualifiers(groups: StandingGroup[]): string[] {
  const ranked = groups.map((g) => g.standings.map((r) => r.team_id))
  const maxRank = ranked.reduce((n, rows) => Math.max(n, rows.length), 0)
  const out: string[] = []
  const seen = new Set<string>()
  for (let rank = 0; rank < maxRank; rank++) {
    for (const rows of ranked) {
      const tid = rows[rank]
      if (!tid || seen.has(tid)) continue
      seen.add(tid)
      out.push(tid)
    }
  }
  return out
}

/**
 * Map team_id → qualification path from current tables.
 * Plate events: first championshipSize → Cup, next plateSize → Shield, rest Out.
 * Otherwise: top teamsAdvancePerGroup in each group → Qualify, rest Out.
 */
export function qualificationByTeamId(
  groups: StandingGroup[],
  opts: QualTournamentOpts,
): Record<string, QualPath> {
  const map: Record<string, QualPath> = {}
  if (!groups.length) return map

  const format = (opts.format || 'GROUP_KNOCKOUT').toUpperCase()
  if (format === 'ROUND_ROBIN') {
    for (const g of groups) {
      for (const row of g.standings) map[row.team_id] = 'out'
    }
    return map
  }

  if (opts.enablePlate) {
    const champN = Math.max(0, opts.championshipSize ?? 16)
    const plateN = Math.max(0, opts.plateSize ?? 16)
    const ordered = orderedGroupQualifiers(groups)
    ordered.forEach((tid, i) => {
      if (i < champN) map[tid] = 'cup'
      else if (i < champN + plateN) map[tid] = 'shield'
      else map[tid] = 'out'
    })
    // Any team listed in standings but somehow missing
    for (const g of groups) {
      for (const row of g.standings) {
        if (!(row.team_id in map)) map[row.team_id] = 'out'
      }
    }
    return map
  }

  const advance = Math.max(1, opts.teamsAdvancePerGroup ?? 2)
  for (const g of groups) {
    g.standings.forEach((row, i) => {
      map[row.team_id] = i < advance ? 'qualify' : 'out'
    })
  }
  return map
}

export function qualificationLabel(path: QualPath | null | undefined): string {
  if (path === 'cup') return 'Cup'
  if (path === 'shield') return 'Shield'
  if (path === 'qualify') return 'Qualify'
  if (path === 'out') return 'Out'
  return ''
}
