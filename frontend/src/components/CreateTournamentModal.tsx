import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from './ConfirmDialog'
import DraftSponsorsField, { type DraftSponsor } from './DraftSponsorsField'
import ModalShell from './ModalShell'
import TournamentFormFields, { type TournamentFormState } from './TournamentFormFields'
import { apiErrorMessage, tournamentApi } from '../services/api'
import { tournamentFormatSummary } from '../utils/format'

const STEPS = [
  { id: 'event', label: 'Event' },
  { id: 'setup', label: 'Setup' },
  { id: 'sponsors', label: 'Sponsors' },
] as const

type StepId = (typeof STEPS)[number]['id']

type Props = {
  onClose: () => void
  onCreated: (msg: string, id?: string) => void
  /** Shown under the title — e.g. official vs private note */
  subtitle?: string
  onToast?: (msg: string) => void
}

function defaultForm(): TournamentFormState {
  return {
    name: '',
    location: '',
    venue: '',
    event_date: '',
    start_time: '10:00',
    registration_deadline: '',
    play_format: 'DOUBLES',
    format: 'GROUP_KNOCKOUT',
    number_of_courts: 6,
    match_duration_minutes: 20,
    max_teams: 48,
    entry_fee_euros: 50,
    pay_on_arrival: true,
    description: '',
    rules: '',
    group_size: 4,
    teams_advance_per_group: 2,
  }
}

function validateEvent(form: TournamentFormState): string | null {
  if (form.name.trim().length < 3) return 'Enter a tournament name (at least 3 characters)'
  if (!form.location.trim()) return 'Enter a city / area'
  if (!form.venue.trim()) return 'Enter a venue'
  if (!form.event_date) return 'Pick an event date'
  if (!form.start_time) return 'Pick a start time'
  return null
}

export default function CreateTournamentModal({
  onClose,
  onCreated,
  subtitle = 'Private by default — share the invite code or link. Only Student Padel Ireland admin events appear on the landing page.',
  onToast,
}: Props) {
  const qc = useQueryClient()
  const [step, setStep] = useState<StepId>('event')
  const [openRegistration, setOpenRegistration] = useState(true)
  const [form, setForm] = useState<TournamentFormState>(defaultForm)
  const [courtNames, setCourtNames] = useState<string[]>(
    Array.from({ length: 6 }, (_, i) => `Court ${i + 1}`),
  )
  const [sponsors, setSponsors] = useState<DraftSponsor[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  const markDirty = () => setDirty(true)

  const patchForm = (patch: Partial<TournamentFormState>) => {
    markDirty()
    setForm((f) => ({ ...f, ...patch }))
  }

  const setCourtCount = (n: number) => {
    markDirty()
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
      title: 'Discard tournament?',
      message: 'You have unsaved details. Close and lose this draft?',
      confirmLabel: 'Discard',
      danger: true,
    })
    if (ok) onClose()
  }

  const goNext = () => {
    setError('')
    if (step === 'event') {
      const err = validateEvent(form)
      if (err) {
        setError(err)
        return
      }
      setStep('setup')
      return
    }
    if (step === 'setup') {
      setStep('sponsors')
    }
  }

  const goBack = () => {
    setError('')
    if (step === 'setup') setStep('event')
    else if (step === 'sponsors') setStep('setup')
  }

  const summaryLine = useMemo(
    () => tournamentFormatSummary(form.play_format, form.format),
    [form.play_format, form.format],
  )

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (step !== 'sponsors') {
      goNext()
      return
    }
    const eventErr = validateEvent(form)
    if (eventErr) {
      setError(eventErr)
      setStep('event')
      return
    }
    setError('')
    setSaving(true)
    try {
      const { data } = await tournamentApi.create({
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
        format: form.format,
        play_format: form.play_format,
        match_duration_minutes: form.match_duration_minutes,
        group_size: form.group_size,
        teams_advance_per_group: form.teams_advance_per_group,
        registration_deadline: form.registration_deadline
          ? new Date(form.registration_deadline).toISOString()
          : null,
        description: form.description.trim() || null,
        rules: form.rules.trim() || null,
      })

      let sponsorFails = 0
      for (const s of sponsors) {
        try {
          await tournamentApi.createSponsor(data.id, {
            name: s.name,
            website: s.website || undefined,
            featured: s.featured,
            logo: s.logo,
          })
        } catch {
          sponsorFails += 1
        }
      }

      if (openRegistration) {
        try {
          await tournamentApi.update(data.id, { status: 'REGISTRATION_OPEN' })
        } catch {
          await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
          await qc.invalidateQueries({ queryKey: ['tournaments'] })
          onCreated(
            'Tournament created, but registration could not be opened — open it from My events',
            data.id,
          )
          onClose()
          return
        }
      }

      await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      await qc.invalidateQueries({ queryKey: ['tournaments'] })
      await qc.invalidateQueries({ queryKey: ['sponsors', data.slug] })

      let msg = openRegistration
        ? 'Tournament created — registration is open'
        : 'Tournament created as draft'
      if (sponsors.length && sponsorFails === 0) {
        msg += ` · ${sponsors.length} sponsor${sponsors.length === 1 ? '' : 's'} added`
      } else if (sponsorFails > 0) {
        msg += ` · ${sponsorFails} sponsor${sponsorFails === 1 ? '' : 's'} failed — add them from Manage`
      }
      onCreated(msg, data.id)
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not create tournament'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Create tournament"
      titleId="create-tournament-title"
      subtitle={subtitle}
      onClose={() => void requestClose()}
      preventClose={saving}
      closeOnBackdrop={false}
      wide
      className="create-tournament-modal"
      footer={
        <div className="modal-actions tf-step-actions">
          {stepIndex > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={goBack} disabled={saving}>
              Back
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => void requestClose()} disabled={saving}>
              Cancel
            </button>
          )}
          {step !== 'sponsors' ? (
            <button type="button" className="btn btn-primary" onClick={goNext} disabled={saving}>
              Continue
            </button>
          ) : (
            <button type="submit" form="create-tournament-form" className="btn btn-primary" disabled={saving}>
              {saving
                ? sponsors.length
                  ? 'Creating & uploading…'
                  : 'Creating…'
                : openRegistration
                  ? 'Create & open registration'
                  : 'Create draft'}
            </button>
          )}
        </div>
      }
    >
      <nav className="tf-steps" aria-label="Create steps">
        {STEPS.map((s, i) => {
          const active = s.id === step
          const done = i < stepIndex
          return (
            <button
              key={s.id}
              type="button"
              className={`tf-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
              disabled={saving || (!done && !active)}
              onClick={() => {
                if (done) {
                  setError('')
                  setStep(s.id)
                }
              }}
            >
              <span className="tf-step-num">{i + 1}</span>
              <span className="tf-step-label">{s.label}</span>
            </button>
          )
        })}
      </nav>

      <form id="create-tournament-form" onSubmit={onSubmit}>
        {step === 'event' && (
          <TournamentFormFields
            form={form}
            onChange={patchForm}
            courtNames={courtNames}
            onCourtNamesChange={(names) => {
              markDirty()
              setCourtNames(names)
            }}
            onCourtCountChange={setCourtCount}
            mode="create"
            sections={['event', 'info']}
          />
        )}

        {step === 'setup' && (
          <>
            <p className="tf-step-summary muted">{summaryLine}</p>
            <TournamentFormFields
              form={form}
              onChange={patchForm}
              courtNames={courtNames}
              onCourtNamesChange={(names) => {
                markDirty()
                setCourtNames(names)
              }}
              onCourtCountChange={setCourtCount}
              mode="create"
              sections={['format', 'courts', 'fee', 'registration']}
              openRegistration={openRegistration}
              onOpenRegistrationChange={(v) => {
                markDirty()
                setOpenRegistration(v)
              }}
            />
          </>
        )}

        {step === 'sponsors' && (
          <section className="tf-section">
            <h3 className="tf-section-title">Sponsors</h3>
            <DraftSponsorsField
              sponsors={sponsors}
              onChange={(next) => {
                markDirty()
                setSponsors(next)
              }}
              disabled={saving}
              onToast={onToast}
            />
            <div className="tf-create-review">
              <h3 className="tf-section-title">Ready to create</h3>
              <ul className="tf-review-list">
                <li>
                  <strong>{form.name.trim() || 'Untitled'}</strong>
                  {form.location.trim() ? ` · ${form.location.trim()}` : ''}
                </li>
                <li>
                  {form.event_date || 'No date'}
                  {form.start_time ? ` · ${form.start_time}` : ''} · {form.venue.trim() || 'No venue'}
                </li>
                <li>{summaryLine}</li>
                <li>
                  {openRegistration ? 'Registration opens immediately' : 'Saved as draft'}
                  {sponsors.length
                    ? ` · ${sponsors.length} sponsor${sponsors.length === 1 ? '' : 's'}`
                    : ' · No sponsors yet'}
                </li>
              </ul>
            </div>
          </section>
        )}

        {error && <p className="auth-error">{error}</p>}
      </form>
    </ModalShell>
  )
}
