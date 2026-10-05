import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import TournamentFormFields, { type TournamentFormState } from './TournamentFormFields'
import { apiErrorMessage, tournamentApi, type Tournament } from '../services/api'
import { toDatetimeLocalValue, tournamentFormatSummary } from '../utils/format'

type Props = {
  tournament: Tournament
  /** True when matches/fixtures already exist — locks format switches. */
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
    description: tournament.description || '',
    rules: tournament.rules || '',
    group_size: tournament.group_size,
    teams_advance_per_group: tournament.teams_advance_per_group,
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
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const formatLocked =
    fixturesExist ||
    tournament.status === 'LIVE' ||
    tournament.status === 'COMPLETED' ||
    tournament.status === 'CANCELLED'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const patchForm = (patch: Partial<TournamentFormState>) => {
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
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
        max_teams: form.max_teams,
        match_duration_minutes: form.match_duration_minutes,
        group_size: form.group_size,
        teams_advance_per_group: form.teams_advance_per_group,
        registration_deadline: form.registration_deadline
          ? new Date(form.registration_deadline).toISOString()
          : null,
        description: form.description.trim() || null,
        rules: form.rules.trim() || null,
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
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-tournament-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tf-modal-head">
          <div>
            <h2 id="edit-tournament-title">Edit tournament</h2>
            <p className="tf-modal-sub">{tournamentFormatSummary(form.play_format, form.format)}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>
            Close
          </button>
        </header>

        <form onSubmit={onSubmit}>
          <TournamentFormFields
            form={form}
            onChange={patchForm}
            courtNames={courtNames}
            onCourtNamesChange={setCourtNames}
            onCourtCountChange={setCourtCount}
            mode="edit"
            formatLocked={formatLocked}
            tournamentStatus={tournament.status}
          />

          {error && <p className="auth-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
