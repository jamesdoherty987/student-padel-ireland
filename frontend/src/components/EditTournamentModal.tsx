import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from './ConfirmDialog'
import ModalShell from './ModalShell'
import TournamentFormFields, { type TournamentFormState } from './TournamentFormFields'
import {
  draftsFromApi,
  draftsToPayload,
  validateRegistrationFields,
  type RegistrationFieldDraft,
} from './RegistrationFieldsEditor'
import { apiErrorMessage, tournamentApi, type Tournament } from '../services/api'
import { toDatetimeLocalValue } from '../utils/format'

type Props = {
  tournament: Tournament
  /** True when matches/fixtures already exist - locks format switches. */
  fixturesExist?: boolean
  onClose: () => void
  onSaved: (msg: string) => void
}

function toForm(tournament: Tournament): TournamentFormState {
  return {
    name: tournament.name,
    location: tournament.location,
    venue: tournament.venue,
    event_date: tournament.event_date.slice(0, 10),
    start_time: (tournament.start_time || '10:00').slice(0, 5),
    registration_deadline: tournament.registration_deadline
      ? toDatetimeLocalValue(tournament.registration_deadline)
      : '',
    play_format: tournament.play_format === 'SINGLES' ? 'SINGLES' : 'DOUBLES',
    format: tournament.format === 'ROUND_ROBIN' ? 'ROUND_ROBIN' : 'GROUP_KNOCKOUT',
    number_of_courts: tournament.number_of_courts,
    match_duration_minutes: tournament.match_duration_minutes,
    max_teams: tournament.max_teams,
    entry_fee_euros: tournament.entry_fee_cents / 100,
    pay_on_arrival: tournament.pay_on_arrival !== false,
    description: tournament.description || '',
    rules: tournament.rules || '',
    group_size: tournament.group_size,
    teams_advance_per_group: tournament.teams_advance_per_group,
    enable_plate: !!tournament.enable_plate,
    championship_size: tournament.championship_size || 16,
    plate_size: tournament.plate_size || 16,
  }
}

function initialCourtNames(tournament: Tournament) {
  const fromApi = (tournament.courts || [])
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((c) => c.name)
  if (fromApi.length) return fromApi
  return Array.from({ length: tournament.number_of_courts }, (_, i) => `Court ${i + 1}`)
}

export default function EditTournamentModal({
  tournament,
  fixturesExist = false,
  onClose,
  onSaved,
}: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState(() => toForm(tournament))
  const [courtNames, setCourtNames] = useState(() => initialCourtNames(tournament))
  const [registrationFields, setRegistrationFields] = useState<RegistrationFieldDraft[]>(() =>
    draftsFromApi(tournament.registration_fields || []),
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const formatLocked =
    fixturesExist ||
    tournament.status === 'LIVE' ||
    tournament.status === 'COMPLETED' ||
    tournament.status === 'CANCELLED'

  const patchForm = (patch: Partial<TournamentFormState>) => {
    setDirty(true)
    setForm((f) => ({ ...f, ...patch }))
  }

  const setCourtCount = (n: number) => {
    const count = Math.max(1, Math.min(32, Number.isFinite(n) ? Math.trunc(n) : 1))
    patchForm({ number_of_courts: count })
    setCourtNames((prev) => {
      const next = [...prev]
      while (next.length < count) next.push(`Court ${next.length + 1}`)
      return next.slice(0, count)
    })
  }

  const requestClose = async () => {
    if (saving) return
    if (!dirty) {
      onClose()
      return
    }
    const ok = await confirmDialog({
      title: 'Discard changes?',
      message: 'You have unsaved edits. Close without saving?',
      confirmLabel: 'Discard',
      danger: true,
    })
    if (ok) onClose()
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const fieldsErr = validateRegistrationFields(registrationFields)
    if (fieldsErr) {
      setError(fieldsErr)
      return
    }
    setError('')
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        location: form.location.trim(),
        venue: form.venue.trim(),
        event_date: form.event_date,
        start_time: form.start_time.length === 5 ? `${form.start_time}:00` : form.start_time,
        number_of_courts: form.number_of_courts,
        court_names: courtNames.map((n, i) => n.trim() || `Court ${i + 1}`),
        entry_fee_cents: Math.round(form.entry_fee_euros * 100),
        pay_on_arrival: form.pay_on_arrival,
        max_teams: form.max_teams,
        match_duration_minutes: form.match_duration_minutes,
        group_size: form.group_size,
        teams_advance_per_group: form.teams_advance_per_group,
        enable_plate: form.enable_plate,
        championship_size: form.championship_size,
        plate_size: form.plate_size,
        registration_deadline: form.registration_deadline
          ? new Date(form.registration_deadline).toISOString()
          : null,
        description: form.description.trim() || null,
        rules: form.rules.trim() || null,
        registration_fields: draftsToPayload(registrationFields),
      }
      if (!formatLocked) {
        payload.format = form.format
        payload.play_format = form.play_format
      }
      await tournamentApi.update(tournament.id, payload)
      await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      await qc.invalidateQueries({ queryKey: ['tournament', tournament.slug] })
      await qc.invalidateQueries({ queryKey: ['tournaments'] })
      onSaved('Tournament updated')
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not save changes'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Edit tournament"
      titleId="edit-tournament-title"
      onClose={() => void requestClose()}
      preventClose={saving}
      closeOnBackdrop={false}
      wide
      footer={
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void requestClose()} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="edit-tournament-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      }
    >
      <form id="edit-tournament-form" onSubmit={onSubmit}>
        <TournamentFormFields
          form={form}
          onChange={patchForm}
          courtNames={courtNames}
          onCourtNamesChange={(names) => {
            setDirty(true)
            setCourtNames(names)
          }}
          onCourtCountChange={setCourtCount}
          mode="edit"
          formatLocked={formatLocked}
          registrationFields={registrationFields}
          onRegistrationFieldsChange={(next) => {
            setDirty(true)
            setRegistrationFields(next)
          }}
        />

        {error && <p className="auth-error">{error}</p>}
      </form>
    </ModalShell>
  )
}
