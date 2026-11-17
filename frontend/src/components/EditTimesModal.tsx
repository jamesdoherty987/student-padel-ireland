import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from './ConfirmDialog'
import ModalShell from './ModalShell'
import NumberInput from './NumberInput'
import { apiErrorMessage, tournamentApi, type Tournament } from '../services/api'
import './EditTimes.css'

type Props = {
  tournament: Tournament
  onClose: () => void
  onDone: (msg: string) => void
}

type Scope = 'knockout' | 'all' | 'groups'

type ShiftResult = {
  updated: number
  skipped_active?: number
  shift_minutes: number
  after_time: string
  stages?: string[] | null
  dry_run?: boolean
}

function stagesForScope(scope: Scope): string[] | undefined {
  if (scope === 'knockout') return ['KNOCKOUT', 'PLATE']
  if (scope === 'groups') return ['GROUP']
  return undefined
}

function scopeLabel(scope: Scope) {
  if (scope === 'knockout') return 'Championship & Plate only'
  if (scope === 'groups') return 'Group stage only'
  return 'All fixtures'
}

function formatShiftDuration(absMins: number) {
  const hours = Math.floor(absMins / 60)
  const mins = absMins % 60
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${mins} min`
}

export default function EditTimesModal({ tournament, onClose, onDone }: Props) {
  const qc = useQueryClient()
  const [afterTime, setAfterTime] = useState('14:00')
  const [shiftMinutes, setShiftMinutes] = useState(60)
  const [scope, setScope] = useState<Scope>('knockout')
  const [preview, setPreview] = useState<ShiftResult | null>(null)
  const [pushError, setPushError] = useState('')
  const [lunchError, setLunchError] = useState('')
  const [lunchEnabled, setLunchEnabled] = useState(
    () => (tournament.lunch_break_minutes || 0) > 0 && !!tournament.lunch_break_start,
  )
  const [lunchStart, setLunchStart] = useState(() =>
    (tournament.lunch_break_start || '14:00').toString().slice(0, 5),
  )
  const [lunchMins, setLunchMins] = useState(() => {
    const n = tournament.lunch_break_minutes || 60
    return n > 0 ? n : 60
  })
  const [tab, setTab] = useState<'push' | 'lunch'>('push')

  const shiftMut = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data } = await tournamentApi.shiftSchedule(tournament.id, {
        after_time: afterTime.length === 5 ? `${afterTime}:00` : afterTime,
        shift_minutes: shiftMinutes,
        stages: stagesForScope(scope),
        dry_run: dryRun,
      })
      return data as ShiftResult
    },
    onSuccess: async (res, dryRun) => {
      if (dryRun) {
        setPreview(res)
        setPushError('')
        return
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['org-matches'] }),
        qc.invalidateQueries({ queryKey: ['matches'] }),
        qc.invalidateQueries({ queryKey: ['manage-dashboard'] }),
        qc.invalidateQueries({ queryKey: ['tournament', tournament.slug] }),
        qc.invalidateQueries({ queryKey: ['player-view', tournament.slug] }),
      ])
      const skipped = res.skipped_active || 0
      const base =
        res.updated === 0
          ? 'No open matches matched that cutoff'
          : `Updated ${res.updated} match time${res.updated === 1 ? '' : 's'}`
      onDone(skipped > 0 ? `${base} · skipped ${skipped} in-play/finished` : base)
      onClose()
    },
    onError: (e: unknown) => {
      setPushError(apiErrorMessage(e, 'Could not update times'))
    },
  })

  const lunchMut = useMutation({
    mutationFn: async () => {
      await tournamentApi.update(tournament.id, {
        lunch_break_start: lunchEnabled
          ? lunchStart.length === 5
            ? `${lunchStart}:00`
            : lunchStart
          : null,
        lunch_break_minutes: lunchEnabled ? lunchMins : 0,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['tournament', tournament.slug] }),
        qc.invalidateQueries({ queryKey: ['manage-dashboard'] }),
      ])
      onDone(
        lunchEnabled
          ? `Lunch break saved (${lunchStart}, ${lunchMins} mins) — applies on next draw generate`
          : 'Lunch break cleared',
      )
    },
    onError: (e: unknown) => {
      setLunchError(apiErrorMessage(e, 'Could not save lunch break'))
    },
  })

  useEffect(() => {
    setPreview(null)
    setPushError('')
  }, [afterTime, shiftMinutes, scope])

  useEffect(() => {
    setPushError('')
    setLunchError('')
  }, [tab])

  const direction = shiftMinutes >= 0 ? 'later' : 'earlier'
  const absMins = Math.abs(shiftMinutes)
  const summary = useMemo(() => {
    return `Open matches at/after ${afterTime} → ${formatShiftDuration(absMins)} ${direction} · ${scopeLabel(scope)}`
  }, [afterTime, absMins, direction, scope])

  const busy = shiftMut.isPending || lunchMut.isPending
  const previewing = shiftMut.isPending && shiftMut.variables === true
  const applying = shiftMut.isPending && shiftMut.variables === false

  const applyLunchPreset = () => {
    setTab('push')
    setAfterTime('14:00')
    setShiftMinutes(60)
    setScope('knockout')
    setPreview(null)
    setPushError('')
  }

  const onApply = async () => {
    setPushError('')
    let count = preview?.updated
    let skipped = preview?.skipped_active || 0
    if (count == null) {
      try {
        const res = await shiftMut.mutateAsync(true)
        count = res.updated
        skipped = res.skipped_active || 0
      } catch {
        return
      }
    }
    const ok = await confirmDialog({
      title: 'Apply time shift?',
      message: [
        `${count} open match${count === 1 ? '' : 'es'} will move ${formatShiftDuration(absMins)} ${direction}.`,
        scopeLabel(scope) + '.',
        skipped > 0 ? `${skipped} in-play/finished match${skipped === 1 ? '' : 'es'} will be left alone.` : '',
        'Players are not emailed — tell them if times change.',
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: count === 0 ? 'OK' : 'Apply',
    })
    if (!ok || count === 0) return
    shiftMut.mutate(false)
  }

  return (
    <ModalShell
      title="Edit times"
      titleId="edit-times-title"
      subtitle="Push kickoffs in bulk, or save a lunch break for the next draw."
      onClose={onClose}
      preventClose={busy}
      wide
    >
      <div className="edit-times">
        <div className="edit-times-tabs" role="tablist" aria-label="Time tools">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'push'}
            className={`edit-times-tab${tab === 'push' ? ' is-active' : ''}`}
            onClick={() => setTab('push')}
            disabled={busy}
          >
            Push times
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'lunch'}
            className={`edit-times-tab${tab === 'lunch' ? ' is-active' : ''}`}
            onClick={() => setTab('lunch')}
            disabled={busy}
          >
            Lunch break
          </button>
        </div>

        {tab === 'push' ? (
          <div className="edit-times-panel">
            <button
              type="button"
              className="edit-times-preset"
              onClick={applyLunchPreset}
              disabled={busy}
            >
              <strong>Lunch 2–3pm</strong>
              <span>Push Championship &amp; Plate from 14:00 by +1 hour</span>
            </button>

            <div className="edit-times-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="et-after">
                  At or after (Ireland time)
                </label>
                <input
                  id="et-after"
                  type="time"
                  className="form-input"
                  value={afterTime}
                  onChange={(e) => setAfterTime(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="et-shift">
                  Shift (minutes)
                </label>
                <NumberInput
                  id="et-shift"
                  className="form-input"
                  value={shiftMinutes}
                  min={-720}
                  max={720}
                  emptyValue={60}
                  onValueChange={(n) => setShiftMinutes(n)}
                  disabled={busy}
                />
                <p className="form-hint">Positive = later. Negative = earlier.</p>
              </div>
            </div>

            <fieldset className="edit-times-scope" disabled={busy}>
              <legend>Which matches</legend>
              {(
                [
                  ['knockout', 'Championship & Plate'],
                  ['all', 'Everything'],
                  ['groups', 'Groups only'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="edit-times-radio">
                  <input
                    type="radio"
                    name="et-scope"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            <p className="edit-times-summary">{summary}</p>
            <p className="edit-times-note">
              Live, called, and finished matches are skipped. Players are not emailed.
            </p>

            {preview ? (
              <p className="edit-times-preview">
                <strong>{preview.updated}</strong> match
                {preview.updated === 1 ? '' : 'es'} would update
                {(preview.skipped_active || 0) > 0
                  ? ` · ${preview.skipped_active} in-play/finished skipped`
                  : ''}
              </p>
            ) : null}
            {pushError ? <p className="form-error">{pushError}</p> : null}

            <div className="edit-times-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !afterTime || shiftMinutes === 0}
                onClick={() => shiftMut.mutate(true)}
              >
                {previewing ? 'Checking…' : 'Preview'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !afterTime || shiftMinutes === 0}
                onClick={() => void onApply()}
              >
                {applying ? 'Updating…' : 'Apply shift'}
              </button>
            </div>
          </div>
        ) : (
          <div className="edit-times-panel">
            <p className="edit-times-note">
              Lunch is used when you <strong>generate / regenerate</strong> the draw. To fix an
              existing schedule today, use <strong>Push times</strong> (or the 2–3pm preset).
            </p>

            <label className="edit-times-toggle">
              <input
                type="checkbox"
                checked={lunchEnabled}
                disabled={busy}
                onChange={(e) => setLunchEnabled(e.target.checked)}
              />
              <span>
                <strong>Include a lunch break</strong>
                <span className="muted"> No matches scheduled through this window</span>
              </span>
            </label>

            {lunchEnabled ? (
              <div className="edit-times-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="et-lunch-start">
                    Starts
                  </label>
                  <input
                    id="et-lunch-start"
                    type="time"
                    className="form-input"
                    value={lunchStart}
                    disabled={busy}
                    onChange={(e) => setLunchStart(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="et-lunch-mins">
                    Length (minutes)
                  </label>
                  <NumberInput
                    id="et-lunch-mins"
                    className="form-input"
                    min={15}
                    max={180}
                    emptyValue={60}
                    value={lunchMins}
                    disabled={busy}
                    onValueChange={(n) => setLunchMins(Math.max(15, n))}
                  />
                </div>
              </div>
            ) : null}

            {lunchError ? <p className="form-error">{lunchError}</p> : null}

            <div className="edit-times-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || (lunchEnabled && !lunchStart)}
                onClick={() => lunchMut.mutate()}
              >
                {lunchMut.isPending ? 'Saving…' : 'Save lunch settings'}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
