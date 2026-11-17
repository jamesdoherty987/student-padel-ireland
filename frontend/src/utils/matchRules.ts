/** Default event scoring copy for social/student padel (SIMPLE mode). */
export function defaultMatchRulesText(matchDurationMinutes = 20): string {
  const mins = Math.max(5, Math.min(120, Math.round(Number(matchDurationMinutes)) || 20))
  return [
    'Scoring',
    '• First to 21 points (every rally = 1 point). At 20–20, play until one side leads by 2.',
    `• Or: when the ${mins}-minute slot ends, the team ahead wins.`,
    '• Enter the final score in the app (e.g. 21–15).',
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

export function scoringModeLabel(mode?: string | null): string {
  return (mode || '').toUpperCase() === 'BEST_OF_3'
    ? 'Best of 3 sets'
    : 'First to points (e.g. 21–15)'
}
