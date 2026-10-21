import { previewDraw, formatGroupSizes, knockoutRoundLabel } from '../utils/drawPreview'
import type { TournamentFormState } from './TournamentFormFields'

type Props = {
  form: TournamentFormState
  /** Prefer max_teams for create; paid entries for generate confirm */
  teamCount?: number
}

function courtHours(matches: number, durationMins: number, courts: number) {
  if (courts < 1 || matches < 1) return 0
  const parallelRounds = Math.ceil(matches / courts)
  return (parallelRounds * durationMins) / 60
}

/**
 * Live summary of how the draw will look — mirrors official open structure
 * (groups → Championship + optional Plate).
 */
export default function FormatDrawPreview({ form, teamCount }: Props) {
  const n = teamCount ?? form.max_teams
  const preview = previewDraw({
    teamCount: n,
    groupSize: form.group_size,
    teamsAdvancePerGroup: form.teams_advance_per_group,
    format: form.format,
    enablePlate: form.enable_plate,
    championshipSize: form.championship_size,
    plateSize: form.plate_size,
  })

  if (form.format === 'ROUND_ROBIN') {
    return (
      <aside className="tf-draw-preview" aria-live="polite">
        <h3 className="tf-section-title">Draw summary</h3>
        <p className="tf-section-lead">Round robin — everyone plays everyone.</p>
        <ul className="tf-review-list">
          <li>
            {n} {form.play_format === 'SINGLES' ? 'players' : 'teams'}
          </li>
          <li>{preview.groupMatches} matches · ~{form.match_duration_minutes} min each</li>
        </ul>
      </aside>
    )
  }

  if (!preview.ok) {
    return (
      <aside className="tf-draw-preview tf-draw-preview-warn" aria-live="polite">
        <h3 className="tf-section-title">Draw summary</h3>
        <p className="form-error" style={{ margin: 0 }}>
          {preview.error || 'Adjust format settings'}
        </p>
      </aside>
    )
  }

  const players =
    form.play_format === 'SINGLES' ? n : n * 2
  const groupLabel =
    preview.groupSizes.length > 0
      ? `${preview.groupCount} group${preview.groupCount === 1 ? '' : 's'} (${formatGroupSizes(preview.groupSizes)})`
      : '—'

  return (
    <aside className="tf-draw-preview" aria-live="polite">
      <h3 className="tf-section-title">Draw summary</h3>
      <p className="tf-section-lead">Updates as you change format settings.</p>

      <ul className="tf-review-list">
        <li>
          <strong>
            {n} {form.play_format === 'SINGLES' ? 'players' : 'teams'}
          </strong>
          {form.play_format !== 'SINGLES' ? ` / ${players} players` : ''}
        </li>
        <li>{groupLabel}</li>
        <li>
          {preview.groupMatches} group-stage matches
          {preview.groupCount > 0 && preview.groupSizes[0] === 4
            ? ' · 3 per team in a group of 4'
            : ''}
        </li>
        {form.enable_plate ? (
          <>
            <li>
              {preview.championshipSize} teams → Championship knockout
              {preview.knockoutRounds.length
                ? ` (${preview.knockoutRounds.map(knockoutRoundLabel).join(' → ')})`
                : ''}
            </li>
            <li>
              {preview.plateSize} teams → Plate competition
              {preview.plateRounds.length
                ? ` (${preview.plateRounds.map(knockoutRoundLabel).join(' → ')})`
                : ''}
            </li>
          </>
        ) : (
          <li>
            {preview.advancing} advance to knockout
            {preview.byeSlots > 0 ? ` · ${preview.byeSlots} bye${preview.byeSlots === 1 ? '' : 's'}` : ''}
            {preview.knockoutRounds.length
              ? ` · ${preview.knockoutRounds.map(knockoutRoundLabel).join(' → ')}`
              : ''}
          </li>
        )}
        <li>Matches ~{form.match_duration_minutes} minutes · {form.number_of_courts} courts</li>
        <li>
          ~{courtHours(preview.totalMatches, form.match_duration_minutes, form.number_of_courts).toFixed(1)}{' '}
          court-hours total (courts can be reduced as rounds shrink)
        </li>
      </ul>

      {preview.note ? <p className="muted-note">{preview.note}</p> : null}
    </aside>
  )
}
