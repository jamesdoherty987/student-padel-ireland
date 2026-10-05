import NumberInput from './NumberInput'
import {
  bracketFormatHint,
  bracketFormatLabel,
  playFormatHint,
  playFormatLabel,
  tournamentFormatSummary,
} from '../utils/format'

export type TournamentFormState = {
  name: string
  location: string
  venue: string
  event_date: string
  start_time: string
  registration_deadline: string
  play_format: string
  format: string
  number_of_courts: number
  match_duration_minutes: number
  max_teams: number
  entry_fee_euros: number
  description: string
  rules: string
  group_size: number
  teams_advance_per_group: number
}

type Props = {
  form: TournamentFormState
  onChange: (patch: Partial<TournamentFormState>) => void
  courtNames: string[]
  onCourtNamesChange: (names: string[]) => void
  onCourtCountChange: (n: number) => void
  mode: 'create' | 'edit'
  /** When true, play_format + bracket format are read-only (fixtures already exist). */
  formatLocked?: boolean
  /** Optional status for locked-format messaging */
  tournamentStatus?: string
  openRegistration?: boolean
  onOpenRegistrationChange?: (v: boolean) => void
}

export default function TournamentFormFields({
  form,
  onChange,
  courtNames,
  onCourtNamesChange,
  onCourtCountChange,
  mode,
  formatLocked = false,
  tournamentStatus,
  openRegistration = false,
  onOpenRegistrationChange,
}: Props) {
  const singles = form.play_format === 'SINGLES'
  const entryUnit = singles ? 'player' : 'doubles team'
  const isGroupKnockout = form.format === 'GROUP_KNOCKOUT'

  return (
    <>
      <section className="tf-section">
        <h3 className="tf-section-title">Event details</h3>
        <p className="tf-section-lead">What players see on the public tournament page.</p>

        {(
          [
            ['name', 'Tournament name', 'text', 'e.g. UL Spring Open'],
            ['location', 'City / area', 'text', 'e.g. Limerick'],
            ['venue', 'Venue', 'text', 'e.g. UL Arena Padel'],
            ['event_date', 'Date', 'date', ''],
            ['start_time', 'Start time', 'time', ''],
          ] as const
        ).map(([key, label, type, placeholder]) => (
          <div className="form-group" key={key}>
            <label className="form-label" htmlFor={`tf-${key}`}>
              {label}
            </label>
            <input
              id={`tf-${key}`}
              className="form-input"
              type={type}
              placeholder={placeholder || undefined}
              value={String(form[key])}
              onChange={(e) => onChange({ [key]: e.target.value })}
              required
            />
          </div>
        ))}

        <div className="form-group">
          <label className="form-label" htmlFor="tf-deadline">
            Registration deadline <span className="tf-optional">(optional)</span>
          </label>
          <input
            id="tf-deadline"
            className="form-input"
            type="datetime-local"
            value={form.registration_deadline}
            onChange={(e) => onChange({ registration_deadline: e.target.value })}
          />
          <small className="form-hint">After this time, new entries stop. Leave blank to close manually.</small>
        </div>
      </section>

      <section className="tf-section">
        <h3 className="tf-section-title">Format</h3>
        <p className="tf-section-lead">How people enter and how the draw works.</p>

        {formatLocked ? (
          <div className="tf-format-locked">
            <strong>{tournamentFormatSummary(form.play_format, form.format)}</strong>
            <p className="muted">{bracketFormatHint(form.format)}</p>
            <small className="form-hint">
              {tournamentStatus === 'LIVE' || tournamentStatus === 'COMPLETED'
                ? 'Format can’t be changed while the event is live or finished.'
                : 'Format is locked after the draw exists. Close registration and regenerate the draw to change it.'}
            </small>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="tf-play-format">
                Singles or doubles
              </label>
              <select
                id="tf-play-format"
                className="form-select"
                value={form.play_format}
                onChange={(e) => onChange({ play_format: e.target.value })}
              >
                <option value="DOUBLES">Doubles (pairs)</option>
                <option value="SINGLES">Singles (1v1)</option>
              </select>
              <small className="form-hint">{playFormatHint(form.play_format)}</small>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="tf-format">
                Bracket format
              </label>
              <select
                id="tf-format"
                className="form-select"
                value={form.format}
                onChange={(e) => onChange({ format: e.target.value })}
              >
                <option value="GROUP_KNOCKOUT">Groups then knockout</option>
                <option value="ROUND_ROBIN">Round robin</option>
              </select>
              <small className="form-hint">{bracketFormatHint(form.format)}</small>
            </div>
          </>
        )}

        {isGroupKnockout && (
          <div className="tf-advanced">
            <div className="form-group">
              <label className="form-label" htmlFor="tf-group-size">
                Teams per group
              </label>
              <NumberInput
                id="tf-group-size"
                className="form-input"
                min={2}
                max={8}
                emptyValue={4}
                value={form.group_size}
                onValueChange={(n) => onChange({ group_size: n })}
              />
              <small className="form-hint">
                Typical: 3–4 {singles ? 'players' : 'teams'} per group
                {formatLocked ? '. Takes effect when you regenerate the draw.' : '.'}
              </small>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="tf-advance">
                Advance to knockout per group
              </label>
              <NumberInput
                id="tf-advance"
                className="form-input"
                min={1}
                max={4}
                emptyValue={2}
                value={form.teams_advance_per_group}
                onValueChange={(n) => onChange({ teams_advance_per_group: n })}
              />
              <small className="form-hint">
                How many from each group go into the knockout stage
                {formatLocked ? '. Takes effect when you regenerate the draw.' : '.'}
              </small>
            </div>
          </div>
        )}
      </section>

      <section className="tf-section">
        <h3 className="tf-section-title">Courts & schedule</h3>
        <p className="tf-section-lead">Used for the live board and match start times.</p>

        <div className="form-group">
          <label className="form-label" htmlFor="tf-courts">
            Number of courts
          </label>
          <NumberInput
            id="tf-courts"
            className="form-input"
            min={1}
            max={32}
            emptyValue={1}
            value={form.number_of_courts}
            onValueChange={onCourtCountChange}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Court names</label>
          <small className="form-hint" style={{ marginBottom: '0.45rem' }}>
            Shown to players and on the TV board — e.g. Glass Court, Court 3.
          </small>
          <div className="court-name-grid">
            {courtNames.map((name, i) => (
              <input
                key={i}
                className="form-input"
                value={name}
                onChange={(e) => {
                  const next = [...courtNames]
                  next[i] = e.target.value
                  onCourtNamesChange(next)
                }}
                placeholder={`Court ${i + 1}`}
                aria-label={`Court ${i + 1} name`}
              />
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="tf-match-mins">
            Match length (minutes)
          </label>
          <NumberInput
            id="tf-match-mins"
            className="form-input"
            min={5}
            max={120}
            emptyValue={20}
            value={form.match_duration_minutes}
            onValueChange={(n) => onChange({ match_duration_minutes: n })}
          />
          <small className="form-hint">Used to schedule start times across courts when you generate the draw.</small>
        </div>
      </section>

      <section className="tf-section">
        <h3 className="tf-section-title">Capacity & fee</h3>

        <div className="form-group">
          <label className="form-label" htmlFor="tf-max">
            Max {singles ? 'players' : 'doubles teams'}
          </label>
          <NumberInput
            id="tf-max"
            className="form-input"
            min={2}
            max={256}
            emptyValue={2}
            value={form.max_teams}
            onValueChange={(n) => onChange({ max_teams: n })}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="tf-fee">
            Entry fee (€ per {entryUnit})
          </label>
          <NumberInput
            id="tf-fee"
            className="form-input"
            min={0}
            step={0.5}
            emptyValue={0}
            value={form.entry_fee_euros}
            onValueChange={(n) => onChange({ entry_fee_euros: n })}
          />
          {!singles && (
            <small className="form-hint">
              = €{(form.entry_fee_euros / 2).toFixed(2).replace(/\.00$/, '')} per player. Captain pays the full team fee.
            </small>
          )}
          {singles && <small className="form-hint">Each player pays this amount when they join.</small>}
        </div>
      </section>

      <section className="tf-section">
        <h3 className="tf-section-title">Player information</h3>
        <p className="tf-section-lead">Optional notes on the public page and join flow.</p>

        <div className="form-group">
          <label className="form-label" htmlFor="tf-desc">
            Description <span className="tf-optional">(optional)</span>
          </label>
          <textarea
            id="tf-desc"
            className="form-textarea"
            rows={2}
            placeholder="Short note players see — level, prizes, what to bring"
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="tf-rules">
            Rules <span className="tf-optional">(optional)</span>
          </label>
          <textarea
            id="tf-rules"
            className="form-textarea"
            rows={3}
            placeholder="Scoring, check-in time, house rules"
            value={form.rules}
            onChange={(e) => onChange({ rules: e.target.value })}
          />
        </div>
      </section>

      {mode === 'create' && onOpenRegistrationChange && (
        <label className="tf-check">
          <input
            type="checkbox"
            checked={openRegistration}
            onChange={(e) => onOpenRegistrationChange(e.target.checked)}
          />
          <span>
            Open registration now
            <small className="form-hint">
              Players can join immediately. Otherwise it stays a draft until you open it.
            </small>
          </span>
        </label>
      )}

      {mode === 'edit' && !formatLocked && (
        <p className="tf-edit-note muted">
          Editing {playFormatLabel(form.play_format).toLowerCase()} · {bracketFormatLabel(form.format).toLowerCase()}.
          Changes save to the public page right away.
        </p>
      )}
    </>
  )
}
