/** Clamp SIMPLE “first to N” target used in forms and labels. */
export function clampPointsToWin(raw?: number | null) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return 21
  return Math.max(5, Math.min(99, n))
}

/** Default event scoring copy for social/student padel (SIMPLE mode). */
export function defaultMatchRulesText(
  matchDurationMinutes = 20,
  pointsToWin = 21,
): string {
  const mins = Math.max(5, Math.min(120, Math.round(Number(matchDurationMinutes)) || 20))
  const pts = clampPointsToWin(pointsToWin)
  const deuce = Math.max(0, pts - 1)
  return [
    'Scoring',
    `• First to ${pts} points (every rally = 1 point). At ${deuce}–${deuce}, play until one side leads by 2.`,
    `• Or: when the ${mins}-minute slot ends, the team ahead wins.`,
    `• Enter the final score in the app (e.g. ${pts}–${Math.max(0, pts - 6)}).`,
    '',
    'Time',
    `• Matches are timed to about ${mins} minutes so courts stay on schedule.`,
    '• If time is called mid-point, finish that point — don’t start a new one.',
    '',
    'Disputes',
    '• Replay the point, or ask an organiser.',
  ].join('\n')
}

export function defaultBestOf3RulesText(): string {
  return [
    'Scoring',
    '• Best of 3 sets (first to 6 games, win by 2). Tie-break at 6–6.',
    '• Golden point on deuce (one deciding point).',
    '• Enter set scores in the app.',
  ].join('\n')
}

export function scoringModeLabel(mode?: string | null, pointsToWin?: number | null) {
  if ((mode || '').toUpperCase() === 'BEST_OF_3') return 'Best of 3 sets'
  const pts = clampPointsToWin(pointsToWin)
  return `First to ${pts}`
}
