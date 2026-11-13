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
  number_of_courts: number
  max_teams: number
  entry_fee_euros: number
  pay_on_arrival: boolean
}

function defaultForm(): FormState {
  return {
    name: '',
    location: '',
    venue: '',
    event_date: '',
    start_time: '10:00',
    play_format: 'DOUBLES',
    number_of_courts: 4,
    max_teams: 16,
    entry_fee_euros: 0,
    pay_on_arrival: true,
  }
}

function validate(form: FormState): string | null {
  if (form.name.trim().length < 3) return 'Enter a name (at least 3 characters)'
  if (!form.location.trim()) return 'Enter a city / area'
  if (!form.venue.trim()) return 'Enter a venue'
  if (!form.event_date) return 'Pick a date'
  if (!form.start_time) return 'Pick a start time'
  if (form.max_teams < 2) return 'Need at least 2 entries'
  return null
}

export default function CreatePrivateEventModal({ onClose, onCreated }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(() => defaultForm())
  const [openRegistration, setOpenRegistration] = useState(true)
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
      const fee = Math.max(0, Math.round(form.entry_fee_euros * 100))
      const courts = Math.max(1, Math.min(32, form.number_of_courts))
      const { data } = await tournamentApi.create({
        name: form.name.trim(),
        location: form.location.trim(),
        venue: form.venue.trim(),
        event_date: form.event_date,
        start_time: form.start_time.length === 5 ? `${form.start_time}:00` : form.start_time,
        number_of_courts: courts,
        court_names: Array.from({ length: courts }, (_, i) => `Court ${i + 1}`),
        entry_fee_cents: fee,
        pay_on_arrival: fee === 0 ? true : form.pay_on_arrival,
        refunds_on_withdrawal: true,
        max_teams: form.max_teams,
        format: 'GROUP_KNOCKOUT',
        play_format: form.play_format,
        match_duration_minutes: 20,
        group_size: 4,
        teams_advance_per_group: 2,
        enable_plate: false,
        championship_size: 8,
        plate_size: 8,
        scoring_mode: 'SIMPLE',
        is_official: false,
        registration_deadline: null,
        description: null,
        rules: 'Friendly private event. Agree scoring with your group on the day.',
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

  return (
    <ModalShell
      title="Host a private event"
      titleId="create-private-event-title"
      onClose={() => void requestClose()}
      preventClose={saving}
      closeOnBackdrop={false}
      wide
      className="create-tournament-modal create-private-event-modal"
      footer={
        <div className="modal-actions tf-step-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void requestClose()} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="create-private-event-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : openRegistration ? 'Create & open' : 'Create draft'}
          </button>
        </div>
      }
    >
      <form id="create-private-event-form" onSubmit={onSubmit}>
        <div className="private-event-notice" role="note">
          <strong>Private · invite only</strong>
          <p>
            Not an official Student Padel Ireland tournament. It won’t appear on the public
            list — friends join with your invite code.
          </p>
        </div>

        <section className="tf-section">
          <h3 className="tf-section-title">Basics</h3>
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
              required
            />
          </div>
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
              required
            />
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
                Start time
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
          <h3 className="tf-section-title">Setup</h3>
          <div className="form-group">
            <label className="form-label" htmlFor="pe-play">
              Play
            </label>
            <select
              id="pe-play"
              className="form-select"
              value={form.play_format}
              onChange={(e) => patch({ play_format: e.target.value as 'DOUBLES' | 'SINGLES' })}
            >
              <option value="DOUBLES">Doubles</option>
              <option value="SINGLES">Singles</option>
            </select>
          </div>
          <div className="pe-row">
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
          <div className="form-group">
            <label className="form-label" htmlFor="pe-fee">
              Entry fee (€ / {singles ? 'player' : 'team'})
            </label>
            <NumberInput
              id="pe-fee"
              className="form-input"
              value={form.entry_fee_euros}
              min={0}
              max={500}
              step={1}
              onValueChange={(n) => patch({ entry_fee_euros: n })}
            />
          </div>
          {form.entry_fee_euros > 0 && (
            <label className="tf-check" style={{ marginTop: '0.35rem' }}>
              <input
                type="checkbox"
                checked={form.pay_on_arrival}
                onChange={(e) => patch({ pay_on_arrival: e.target.checked })}
              />
              <span>Collect fee on arrival (no online payment)</span>
            </label>
          )}
          <p className="form-hint" style={{ marginTop: '0.75rem' }}>
            Groups → knockout is set up for you. Tweak the draw in Manage after creating.
          </p>
        </section>

        <section className="tf-section">
          <label className="tf-check">
            <input
              type="checkbox"
              checked={openRegistration}
              onChange={(e) => {
                setDirty(true)
                setOpenRegistration(e.target.checked)
              }}
            />
            <span>Open registration now so friends can join with the code</span>
          </label>
        </section>

        {error && <p className="auth-error">{error}</p>}
      </form>
    </ModalShell>
  )
}
