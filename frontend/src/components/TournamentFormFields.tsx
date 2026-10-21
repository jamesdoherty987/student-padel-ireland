import FormatDrawPreview from './FormatDrawPreview'
import NumberInput from './NumberInput'
import { tournamentFormatSummary } from '../utils/format'

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
  pay_on_arrival: boolean
  description: string
  rules: string
  group_size: number
  teams_advance_per_group: number
  enable_plate: boolean
  championship_size: number
  plate_size: number
}

export type TournamentFormSection =
  | 'event'
  | 'format'
  | 'courts'
  | 'fee'
  | 'info'
  | 'registration'
  | 'preview'

const ALL_SECTIONS: TournamentFormSection[] = [
  'event',
  'format',
  'courts',
  'fee',
  'info',
  'registration',
]

type Props = {
  form: TournamentFormState
  onChange: (patch: Partial<TournamentFormState>) => void
  courtNames: string[]
  onCourtNamesChange: (names: string[]) => void
  onCourtCountChange: (n: number) => void
  mode: 'create' | 'edit'
  /** When true, play_format + bracket format are read-only (fixtures already exist). */
  formatLocked?: boolean
  openRegistration?: boolean
  onOpenRegistrationChange?: (v: boolean) => void
  /** Limit which blocks render (used by stepped create flow). */
  sections?: TournamentFormSection[]
}

export default function TournamentFormFields({
  form,
  onChange,
  courtNames,
  onCourtNamesChange,
  onCourtCountChange,
  mode,
  formatLocked = false,
  openRegistration = false,
  onOpenRegistrationChange,
  sections = ALL_SECTIONS,
}: Props) {
  const singles = form.play_format === 'SINGLES'
  const entryUnit = singles ? 'player' : 'doubles team'
  const isGroupKnockout = form.format === 'GROUP_KNOCKOUT'
  const show = (s: TournamentFormSection) => sections.includes(s)

  return (
    <>
      {show('event') && (
      <section className="tf-section">
        <h3 className="tf-section-title">Event details</h3>

        {(
          [
            ['name', 'Tournament name', 'text', 'e.g. UL Spring Open'],
            ['location', 'City / area', 'text', 'e.g. Cork'],
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
        </div>
      </section>
      )}

      {show('format') && (
      <section className="tf-section">
        <h3 className="tf-section-title">Format</h3>

        {formatLocked ? (
          <div className="tf-format-locked">
            <strong>{tournamentFormatSummary(form.play_format, form.format)}</strong>
            <small className="form-hint">Format locked after the draw exists.</small>
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
                disabled={formatLocked}
              />
            </div>

            <label className="tf-check" style={{ marginTop: '0.5rem' }}>
              <input
                type="checkbox"
                checked={form.enable_plate}
                disabled={formatLocked}
                onChange={(e) => onChange({ enable_plate: e.target.checked })}
              />
              <span>Championship + Plate</span>
            </label>

            {form.enable_plate ? (
              <div className="admin-form-row admin-form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="tf-champ-size">
                    Championship bracket
                  </label>
                  <select
                    id="tf-champ-size"
                    className="form-select"
                    value={form.championship_size}
                    disabled={formatLocked}
                    onChange={(e) => onChange({ championship_size: Number(e.target.value) })}
                  >
                    {[4, 8, 16, 32].map((n) => (
                      <option key={n} value={n}>
                        {n} teams
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="tf-plate-size">
                    Plate bracket
                  </label>
                  <select
                    id="tf-plate-size"
                    className="form-select"
                    value={form.plate_size}
                    disabled={formatLocked}
                    onChange={(e) => onChange({ plate_size: Number(e.target.value) })}
                  >
                    {[4, 8, 16, 32].map((n) => (
                      <option key={n} value={n}>
                        {n} teams
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
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
                  disabled={formatLocked}
                />
              </div>
            )}
          </div>
        )}

        {isGroupKnockout && <FormatDrawPreview form={form} />}
      </section>
      )}

      {show('courts') && (
      <section className="tf-section">
        <h3 className="tf-section-title">Courts & schedule</h3>

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
        </div>
      </section>
      )}

      {show('fee') && (
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
            onValueChange={(n) =>
              onChange({
                entry_fee_euros: n,
                ...(n <= 0 ? { pay_on_arrival: false } : {}),
              })
            }
          />
          {!singles && form.entry_fee_euros > 0 && (
            <small className="form-hint">
              = €{(form.entry_fee_euros / 2).toFixed(2).replace(/\.00$/, '')} per player
            </small>
          )}
        </div>

        {form.entry_fee_euros > 0 && (
          <label className="tf-check">
            <input
              type="checkbox"
              checked={form.pay_on_arrival}
              onChange={(e) => onChange({ pay_on_arrival: e.target.checked })}
            />
            <span>Pay on arrival</span>
          </label>
        )}
      </section>
      )}

      {show('info') && (
      <section className="tf-section">
        <h3 className="tf-section-title">Player information</h3>

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
      )}

      {show('registration') && mode === 'create' && onOpenRegistrationChange && (
        <label className="tf-check">
          <input
            type="checkbox"
            checked={openRegistration}
            onChange={(e) => onOpenRegistrationChange(e.target.checked)}
          />
          <span>Open registration now</span>
        </label>
      )}
    </>
  )
}
