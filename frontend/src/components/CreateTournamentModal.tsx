import { useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from './ConfirmDialog'
import DraftSponsorsField, {
  type DraftSponsor,
  type DraftSponsorsFieldHandle,
} from './DraftSponsorsField'
import ModalShell from './ModalShell'
import TournamentFormFields, { type TournamentFormState } from './TournamentFormFields'
import { apiErrorMessage, tournamentApi } from '../services/api'

export type CreateTournamentVariant = 'admin' | 'organiser'

type Props = {
  variant?: CreateTournamentVariant
  onClose: () => void
  onCreated: (msg: string, id?: string) => void
  onToast?: (msg: string) => void
}

function defaultForm(variant: CreateTournamentVariant): TournamentFormState {
  const official = variant === 'admin'
  return {
    name: '',
    location: '',
    venue: '',
    event_date: '',
    start_time: '10:00',
    registration_deadline: '',
    play_format: 'DOUBLES',
    format: 'GROUP_KNOCKOUT',
    number_of_courts: official ? 7 : 6,
    match_duration_minutes: 20,
    max_teams: 48,
    entry_fee_euros: 50,
    pay_on_arrival: true,
    description: '',
    rules: official
      ? 'Best of 3 sets. Golden point on deuce. Student ID required on the day.'
      : 'Best of 3 sets. Golden point on deuce.',
    group_size: 4,
    teams_advance_per_group: 2,
    enable_plate: official,
    championship_size: 16,
    plate_size: 16,
  }
}

function courtNamesFor(count: number) {
  return Array.from({ length: count }, (_, i) => `Court ${i + 1}`)
}

function validateForm(form: TournamentFormState): string | null {
  if (form.name.trim().length < 3) return 'Enter a tournament name (at least 3 characters)'
  if (!form.location.trim()) return 'Enter a city / area'
  if (!form.venue.trim()) return 'Enter a venue'
  if (!form.event_date) return 'Pick an event date'
  if (!form.start_time) return 'Pick a start time'
  if (form.format === 'GROUP_KNOCKOUT' && form.enable_plate) {
    const need = form.championship_size + form.plate_size
    if (need > form.max_teams) {
      return `Championship (${form.championship_size}) + Plate (${form.plate_size}) need ${need} teams, but max entries is ${form.max_teams}`
    }
  }
  return null
}

export default function CreateTournamentModal({
  variant = 'organiser',
  onClose,
  onCreated,
  onToast,
}: Props) {
  const qc = useQueryClient()
  const isAdmin = variant === 'admin'
  const [openRegistration, setOpenRegistration] = useState(true)
  const [form, setForm] = useState<TournamentFormState>(() => defaultForm(variant))
  const [courtNames, setCourtNames] = useState(() =>
    courtNamesFor(defaultForm(variant).number_of_courts),
  )
  const [sponsors, setSponsors] = useState<DraftSponsor[]>([])
  const sponsorsFieldRef = useRef<DraftSponsorsFieldHandle>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const err = validateForm(form)
    if (err) {
      setError(err)
      return
    }
    setError('')
    setSaving(true)
    try {
      // Include a filled-in sponsor row even if "Add to list" wasn't clicked
      const sponsorsToUpload = sponsorsFieldRef.current?.flush() ?? sponsors

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
        enable_plate: form.enable_plate,
        championship_size: form.championship_size,
        plate_size: form.plate_size,
        registration_deadline: form.registration_deadline
          ? new Date(form.registration_deadline).toISOString()
          : null,
        description: form.description.trim() || null,
        rules: form.rules.trim() || null,
      })

      let sponsorFails = 0
      let lastSponsorError = ''
      for (const s of sponsorsToUpload) {
        try {
          await tournamentApi.createSponsor(data.id, {
            name: s.name,
            website: s.website || undefined,
            featured: s.featured,
            logo: s.logo,
          })
        } catch (err: unknown) {
          sponsorFails += 1
          lastSponsorError = apiErrorMessage(err, 'Sponsor upload failed')
        }
      }

      if (openRegistration) {
        try {
          await tournamentApi.update(data.id, { status: 'REGISTRATION_OPEN' })
        } catch {
          await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
          await qc.invalidateQueries({ queryKey: ['tournaments'] })
          await qc.invalidateQueries({ queryKey: ['sponsors', data.slug] })
          let msg =
            'Tournament created, but registration could not be opened - open it from My events'
          if (sponsorsToUpload.length && sponsorFails === 0) {
            msg += ` · ${sponsorsToUpload.length} sponsor${sponsorsToUpload.length === 1 ? '' : 's'} saved`
          } else if (sponsorFails > 0) {
            msg += ` · ${sponsorFails} sponsor${sponsorFails === 1 ? '' : 's'} failed${lastSponsorError ? ` (${lastSponsorError})` : ''} - add from Manage`
          }
          onCreated(msg, data.id)
          onClose()
          return
        }
      }

      await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      await qc.invalidateQueries({ queryKey: ['tournaments'] })
      await qc.invalidateQueries({ queryKey: ['sponsors', data.slug] })

      let msg = openRegistration
        ? isAdmin
          ? 'Official tournament created - registration is open'
          : 'Tournament created - registration is open'
        : isAdmin
          ? 'Official tournament created as draft'
          : 'Tournament created as draft'
      if (sponsorsToUpload.length && sponsorFails === 0) {
        msg += ` · ${sponsorsToUpload.length} sponsor${sponsorsToUpload.length === 1 ? '' : 's'} saved`
      } else if (sponsorFails > 0) {
        msg += ` · ${sponsorFails} sponsor${sponsorFails === 1 ? '' : 's'} failed${lastSponsorError ? ` (${lastSponsorError})` : ''} - add from Manage`
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
      title={isAdmin ? 'New official tournament' : 'Create tournament'}
      titleId="create-tournament-title"
      onClose={() => void requestClose()}
      preventClose={saving}
      closeOnBackdrop={false}
      wide
      className="create-tournament-modal"
      footer={
        <div className="modal-actions tf-step-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void requestClose()} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="create-tournament-form" className="btn btn-primary" disabled={saving}>
            {saving
              ? sponsors.length
                ? 'Creating & uploading…'
                : 'Creating…'
              : openRegistration
                ? 'Create & open registration'
                : 'Create draft'}
          </button>
        </div>
      }
    >
      <form id="create-tournament-form" onSubmit={onSubmit}>
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
          openRegistration={openRegistration}
          onOpenRegistrationChange={(v) => {
            markDirty()
            setOpenRegistration(v)
          }}
        />

        <section className="tf-section">
          <h3 className="tf-section-title">Sponsors</h3>
          <DraftSponsorsField
            ref={sponsorsFieldRef}
            sponsors={sponsors}
            onChange={(next) => {
              markDirty()
              setSponsors(next)
            }}
            disabled={saving}
            onToast={onToast}
          />
        </section>

        {error && <p className="auth-error">{error}</p>}
      </form>
    </ModalShell>
  )
}
