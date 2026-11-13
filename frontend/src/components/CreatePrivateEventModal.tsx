import { useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from './ConfirmDialog'
import ModalShell from './ModalShell'
import NumberInput from './NumberInput'
import { apiErrorMessage, tournamentApi } from '../services/api'
import './TournamentForm.css'

type Props = {
  onClose: () => void
  onCreated: (msg: string, id?: string) => void
}

type FormState = {
  name: string
  location: string
  venue: string
  event_date: string
  start_time: string
  play_format: 'DOUBLES' | 'SINGLES'
  format: 'GROUP_KNOCKOUT' | 'ROUND_ROBIN'
  number_of_courts: number
  max_teams: number
  match_duration_minutes: number
  group_size: number
  teams_advance_per_group: number
  enable_plate: boolean
  championship_size: number
  plate_size: number
  scoring_mode: 'SIMPLE' | 'BEST_OF_3'
  rules: string
}

function defaultForm(): FormState {
  return {
    name: '',
    location: '',
    venue: '',
    event_date: '',
    start_time: '10:00',
    play_format: 'DOUBLES',
    format: 'GROUP_KNOCKOUT',
    number_of_courts: 4,
    max_teams: 16,
    match_duration_minutes: 20,
    group_size: 4,
    teams_advance_per_group: 2,
    enable_plate: false,
    championship_size: 8,
    plate_size: 8,
    scoring_mode: 'SIMPLE',
    rules: 'Friendly private event. Agree scoring with your group on the day.',
  }
}

function powerOfTwoBracket(n: number) {
  const allowed = [4, 8, 16, 32]
  return allowed.includes(n) ? n : 8
}

function validate(form: FormState): string | null {
  if (form.name.trim().length < 3) return 'Enter a name (at least 3 characters)'
  if (!form.location.trim()) return 'Enter a city / area'
  if (!form.venue.trim()) return 'Enter a venue'
  if (!form.event_date) return 'Pick a date'
  if (!form.start_time) return 'Pick a start time'
  if (form.max_teams < 2) return 'Need at least 2 entries'
  if (form.format === 'GROUP_KNOCKOUT' && form.enable_plate) {
    const need = form.championship_size + form.plate_size
    if (need > form.max_teams) {
      return `Championship (${form.championship_size}) + Plate (${form.plate_size}) need ${need} entries, but max is ${form.max_teams}`
    }
  }
  return null
}

export default function CreatePrivateEventModal({ onClose, onCreated }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(() => defaultForm())
  const [openRegistration, setOpenRegistration] = useState(true)
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const savingRef = useRef(false)

  const patch = (next: Partial<FormState>) => {
    setDirty(true)
    setForm((f) => ({ ...f, ...next }))
  }

  const requestClose = async () => {
    if (saving) return
    if (!dirty) {
      onClose()
      return
    }
    try {
      const ok = await confirmDialog({
        title: 'Discard private event?',
        message: 'You have unsaved details. Close and lose this draft?',
        confirmLabel: 'Discard',
        danger: true,
      })
      if (ok) onClose()
    } catch {
      onClose()
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (savingRef.current) return
    const err = validate(form)
    if (err) {
      setError(err)
      return
    }
    setError('')
    savingRef.current = true
    setSaving(true)
    try {
      const courts = Math.max(1, Math.min(32, form.number_of_courts))
      const { data } = await tournamentApi.create({
        name: form.name.trim(),
        location: form.location.trim(),
        venue: form.venue.trim(),
        event_date: form.event_date,
        start_time: form.start_time.length === 5 ? `${form.start_time}:00` : form.start_time,
        number_of_courts: courts,
        court_names: Array.from({ length: courts }, (_, i) => `Court ${i + 1}`),
        entry_fee_cents: 0,
        pay_on_arrival: true,
        refunds_on_withdrawal: true,
        max_teams: form.max_teams,
        format: form.format,
        play_format: form.play_format,
        match_duration_minutes: form.match_duration_minutes,
        group_size: form.group_size,
        teams_advance_per_group: form.teams_advance_per_group,
        enable_plate: form.format === 'GROUP_KNOCKOUT' ? form.enable_plate : false,
        championship_size: powerOfTwoBracket(form.championship_size),
        plate_size: powerOfTwoBracket(form.plate_size),
        scoring_mode: form.scoring_mode,
        is_official: false,
        registration_deadline: null,
        description: null,
        rules: form.rules.trim() || null,
        registration_fields: [],
      })

      if (openRegistration) {
        try {
          await tournamentApi.update(data.id, { status: 'REGISTRATION_OPEN' })
        } catch {
          await qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
          await qc.invalidateQueries({ queryKey: ['tournaments'] })
          onCreated(
            'Private event created, but registration could not be opened — open it from Manage',
            data.id,
          )
          onClose()
          return
        }
      }

      await qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
      await qc.invalidateQueries({ queryKey: ['tournaments'] })

      onCreated(
        openRegistration
          ? 'Private event ready — share the invite code with friends'
          : 'Private event saved as draft',
        data.id,
      )
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not create private event'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const singles = form.play_format === 'SINGLES'
  const isGroupKnockout = form.format === 'GROUP_KNOCKOUT'

  return (
    <ModalShell
      title="Host a private event"
      titleId="create-private-event-title"
      subtitle="Invite only · free on the app"
      onClose={() => void requestClose()}
      preventClose={saving}
      closeOnBackdrop={false}
      wide
      className="create-tournament-modal create-private-event-modal"
      footer={
        <div className="modal-actions pe-footer-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void requestClose()} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="create-private-event-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : openRegistration ? 'Create & share' : 'Save draft'}
          </button>
        </div>
      }
    >
      <form id="create-private-event-form" onSubmit={onSubmit}>
        <div className="private-event-notice" role="note">
          <strong>Friends only · not an official SPI event</strong>
          <p>
            Share a code or QR. No card payments — settle court costs yourselves if needed.
          </p>
        </div>

        <section className="tf-section">
          <h3 className="tf-section-title">When & where</h3>
          <div className="form-group">
            <label className="form-label" htmlFor="pe-name">
              Event name
            </label>
            <input
              id="pe-name"
              className="form-input"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Friday padel with friends"
              autoComplete="off"
              enterKeyHint="next"
              required
            />
          </div>
          <div className="pe-row">
            <div className="form-group">
              <label className="form-label" htmlFor="pe-location">
                City / area
              </label>
              <input
                id="pe-location"
                className="form-input"
                value={form.location}
                onChange={(e) => patch({ location: e.target.value })}
                placeholder="Dublin"
                enterKeyHint="next"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pe-venue">
                Venue
              </label>
              <input
                id="pe-venue"
                className="form-input"
                value={form.venue}
                onChange={(e) => patch({ venue: e.target.value })}
                placeholder="Club or courts"
                enterKeyHint="next"
                required
              />
            </div>
          </div>
          <div className="pe-row">
            <div className="form-group">
              <label className="form-label" htmlFor="pe-date">
                Date
              </label>
              <input
                id="pe-date"
                className="form-input"
                type="date"
                value={form.event_date}
                onChange={(e) => patch({ event_date: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pe-time">
                Start
              </label>
              <input
                id="pe-time"
                className="form-input"
                type="time"
                value={form.start_time}
                onChange={(e) => patch({ start_time: e.target.value })}
                required
              />
            </div>
          </div>
        </section>

        <section className="tf-section">
          <h3 className="tf-section-title">Play</h3>
          <div className="pe-seg" role="group" aria-label="Play format">
            <button
              type="button"
              className={`pe-seg-btn${form.play_format === 'DOUBLES' ? ' is-active' : ''}`}
              onClick={() => patch({ play_format: 'DOUBLES' })}
            >
              Doubles
            </button>
            <button
              type="button"
              className={`pe-seg-btn${form.play_format === 'SINGLES' ? ' is-active' : ''}`}
              onClick={() => patch({ play_format: 'SINGLES' })}
            >
              Singles
            </button>
          </div>
          <div className="pe-row" style={{ marginTop: '0.85rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="pe-courts">
                Courts
              </label>
              <NumberInput
                id="pe-courts"
                className="form-input"
                value={form.number_of_courts}
                min={1}
                max={16}
                onValueChange={(n) => patch({ number_of_courts: n })}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pe-max">
                Max {singles ? 'players' : 'teams'}
              </label>
              <NumberInput
                id="pe-max"
                className="form-input"
                value={form.max_teams}
                min={2}
                max={64}
                onValueChange={(n) => patch({ max_teams: n })}
              />
            </div>
          </div>
        </section>

        <section className="tf-section pe-more-wrap">
          <button
            type="button"
            className="pe-more-toggle"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
          >
            <span>{showMore ? 'Hide' : 'More'} settings</span>
            <i className={`fas fa-chevron-${showMore ? 'up' : 'down'}`} aria-hidden />
          </button>
          {showMore && (
            <div className="pe-more-body">
              <div className="form-group">
                <label className="form-label" htmlFor="pe-format">
                  Format
                </label>
                <select
                  id="pe-format"
                  className="form-select"
                  value={form.format}
                  onChange={(e) =>
                    patch({ format: e.target.value as 'GROUP_KNOCKOUT' | 'ROUND_ROBIN' })
                  }
                >
                  <option value="GROUP_KNOCKOUT">Groups then knockout</option>
                  <option value="ROUND_ROBIN">Round robin</option>
                </select>
              </div>

              {isGroupKnockout && (
                <>
                  <div className="pe-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="pe-group-size">
                        Per group
                      </label>
                      <NumberInput
                        id="pe-group-size"
                        className="form-input"
                        value={form.group_size}
                        min={2}
                        max={8}
                        onValueChange={(n) => patch({ group_size: n })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="pe-advance">
                        Advance / group
                      </label>
                      <NumberInput
                        id="pe-advance"
                        className="form-input"
                        value={form.teams_advance_per_group}
                        min={1}
                        max={4}
                        onValueChange={(n) => patch({ teams_advance_per_group: n })}
                        disabled={form.enable_plate}
                      />
                    </div>
                  </div>
                  <label className="tf-check">
                    <input
                      type="checkbox"
                      checked={form.enable_plate}
                      onChange={(e) => patch({ enable_plate: e.target.checked })}
                    />
                    <span>Championship + Plate brackets</span>
                  </label>
                  {form.enable_plate && (
                    <div className="pe-row">
                      <div className="form-group">
                        <label className="form-label" htmlFor="pe-champ">
                          Championship
                        </label>
                        <select
                          id="pe-champ"
                          className="form-select"
                          value={form.championship_size}
                          onChange={(e) => patch({ championship_size: Number(e.target.value) })}
                        >
                          {[4, 8, 16, 32].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="pe-plate">
                          Plate
                        </label>
                        <select
                          id="pe-plate"
                          className="form-select"
                          value={form.plate_size}
                          onChange={(e) => patch({ plate_size: Number(e.target.value) })}
                        >
                          {[4, 8, 16, 32].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="pe-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="pe-scoring">
                    Scoring
                  </label>
                  <select
                    id="pe-scoring"
                    className="form-select"
                    value={form.scoring_mode}
                    onChange={(e) =>
                      patch({ scoring_mode: e.target.value as 'SIMPLE' | 'BEST_OF_3' })
                    }
                  >
                    <option value="SIMPLE">Simple (winner + score)</option>
                    <option value="BEST_OF_3">Best of 3 sets</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pe-duration">
                    Match mins
                  </label>
                  <NumberInput
                    id="pe-duration"
                    className="form-input"
                    value={form.match_duration_minutes}
                    min={10}
                    max={90}
                    onValueChange={(n) => patch({ match_duration_minutes: n })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="pe-rules">
                  Rules note
                </label>
                <textarea
                  id="pe-rules"
                  className="form-input"
                  rows={3}
                  value={form.rules}
                  onChange={(e) => patch({ rules: e.target.value })}
                  placeholder="Optional rules for your group"
                />
              </div>
              <p className="form-hint">
                You can change these later in Manage → Edit before the draw is generated.
              </p>
            </div>
          )}
        </section>

        <section className="tf-section pe-open-wrap">
          <label className="tf-check pe-open-check">
            <input
              type="checkbox"
              checked={openRegistration}
              onChange={(e) => {
                setDirty(true)
                setOpenRegistration(e.target.checked)
              }}
            />
            <span>
              <strong>Open for friends now</strong>
              <em>You’ll get a code and QR to share right away</em>
            </span>
          </label>
        </section>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </ModalShell>
  )
}
