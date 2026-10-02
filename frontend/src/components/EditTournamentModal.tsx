import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import NumberInput from './NumberInput'
import { apiErrorMessage, tournamentApi, type Tournament } from '../services/api'

type Props = {
  tournament: Tournament
  onClose: () => void
  onSaved: (msg: string) => void
}

export default function EditTournamentModal({ tournament, onClose, onSaved }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: tournament.name,
    location: tournament.location,
    venue: tournament.venue,
    event_date: tournament.event_date.slice(0, 10),
    start_time: (tournament.start_time || '10:00').slice(0, 5),
    number_of_courts: tournament.number_of_courts,
    entry_fee_euros: tournament.entry_fee_cents / 100,
    max_teams: tournament.max_teams,
    match_duration_minutes: tournament.match_duration_minutes,
    group_size: tournament.group_size,
    teams_advance_per_group: tournament.teams_advance_per_group,
    registration_deadline: tournament.registration_deadline
      ? tournament.registration_deadline.slice(0, 16)
      : '',
    description: tournament.description || '',
    rules: tournament.rules || '',
  })
  const [courtNames, setCourtNames] = useState<string[]>(() => {
    const fromApi = (tournament.courts || [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((c) => c.name)
    if (fromApi.length) return fromApi
    return Array.from({ length: tournament.number_of_courts }, (_, i) => `Court ${i + 1}`)
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const setCourtCount = (n: number) => {
    const count = Math.max(1, Math.min(32, Number.isFinite(n) ? Math.trunc(n) : 1))
    setForm((f) => ({ ...f, number_of_courts: count }))
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
      await tournamentApi.update(tournament.id, {
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
      })
      await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      await qc.invalidateQueries({ queryKey: ['tournament', tournament.slug] })
      onSaved('Tournament updated')
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not save changes'))
    } finally {
      setSaving(false)
    }
  }

  const singles = tournament.play_format === 'SINGLES'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-tournament-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-tournament-title">Edit tournament</h2>
        <form onSubmit={onSubmit}>
          {(
            [
              ['name', 'Name'],
              ['location', 'Location'],
              ['venue', 'Venue'],
              ['event_date', 'Date', 'date'],
              ['start_time', 'Start time', 'time'],
            ] as const
          ).map(([key, label, type]) => (
            <div className="form-group" key={key}>
              <label className="form-label">{label}</label>
              <input
                className="form-input"
                type={type || 'text'}
                value={String(form[key as keyof typeof form])}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                required
              />
            </div>
          ))}

          <div className="form-group">
            <label className="form-label">Registration deadline (optional)</label>
            <input
              className="form-input"
              type="datetime-local"
              value={form.registration_deadline}
              onChange={(e) => setForm({ ...form, registration_deadline: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Number of courts</label>
            <NumberInput
              className="form-input"
              min={1}
              max={32}
              emptyValue={1}
              value={form.number_of_courts}
              onValueChange={setCourtCount}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Court names</label>
            <div className="org-court-names">
              {courtNames.map((name, i) => (
                <input
                  key={i}
                  className="form-input"
                  value={name}
                  placeholder={`Court ${i + 1}`}
                  onChange={(e) => {
                    const next = [...courtNames]
                    next[i] = e.target.value
                    setCourtNames(next)
                  }}
                />
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Entry fee (€ / {singles ? 'player' : 'team'})</label>
            <NumberInput
              className="form-input"
              min={0}
              step={0.5}
              emptyValue={0}
              value={form.entry_fee_euros}
              onValueChange={(n) => setForm({ ...form, entry_fee_euros: n })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Max {singles ? 'players' : 'teams'}</label>
            <NumberInput
              className="form-input"
              min={2}
              max={256}
              emptyValue={2}
              value={form.max_teams}
              onValueChange={(n) => setForm({ ...form, max_teams: n })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Match length (minutes)</label>
            <NumberInput
              className="form-input"
              min={5}
              max={120}
              emptyValue={20}
              value={form.match_duration_minutes}
              onValueChange={(n) => setForm({ ...form, match_duration_minutes: n })}
            />
          </div>

          {tournament.format === 'GROUP_KNOCKOUT' && (
            <>
              <div className="form-group">
                <label className="form-label">Teams per group</label>
                <NumberInput
                  className="form-input"
                  min={2}
                  max={8}
                  emptyValue={4}
                  value={form.group_size}
                  onValueChange={(n) => setForm({ ...form, group_size: n })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Advance to knockout per group</label>
                <NumberInput
                  className="form-input"
                  min={1}
                  max={4}
                  emptyValue={2}
                  value={form.teams_advance_per_group}
                  onValueChange={(n) => setForm({ ...form, teams_advance_per_group: n })}
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Rules</label>
            <textarea
              className="form-textarea"
              rows={3}
              value={form.rules}
              onChange={(e) => setForm({ ...form, rules: e.target.value })}
            />
          </div>

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
