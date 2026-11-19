import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { confirmDialog } from './ConfirmDialog'
import ScoreStep from './ScoreStep'
import './ScoreSheet.css'
import { scrollFieldAboveKeyboard, useKeyboardInset } from '../hooks/useKeyboardInset'
import { hapticSuccess } from '../native/haptics'
import { apiErrorMessage, tournamentApi, type Match } from '../services/api'
import { courtLabel, formatTime, knockoutRoundLabel } from '../utils/format'

export type OrganiserScoringMode = 'SIMPLE' | 'BEST_OF_3'

type ScoreForm = {
  set1_a: number
  set1_b: number
  set2_a: number
  set2_b: number
  set3_a: number
  set3_b: number
  current_set: number
  status: string
  winner_id: string
  force: boolean
}

function tallySets(form: ScoreForm) {
  const pairs: [number, number][] = [
    [form.set1_a, form.set1_b],
    [form.set2_a, form.set2_b],
    [form.set3_a, form.set3_b],
  ]
  let aSets = 0
  let bSets = 0
  let played = 0
  for (const [a, b] of pairs) {
    if (!(a || b)) continue
    if (a === b) return { ok: false as const, reason: 'Set scores can’t be tied' }
    played += 1
    if (a > b) aSets += 1
    else bSets += 1
  }
  return { ok: true as const, aSets, bSets, played }
}

function resolveCurrentSet(form: ScoreForm) {
  const selected = Math.min(3, Math.max(1, form.current_set || 1))
  if (form.set3_a || form.set3_b) return 3
  if ((form.set2_a || form.set2_b) && selected < 2) return 2
  return selected
}

function formFromMatch(m: Match): ScoreForm {
  const defaultStatus =
    m.status === 'COMPLETED' || m.status === 'WALKOVER' ? m.status : 'COMPLETED'
  return {
    set1_a: m.score?.set1_a ?? 0,
    set1_b: m.score?.set1_b ?? 0,
    set2_a: m.score?.set2_a ?? 0,
    set2_b: m.score?.set2_b ?? 0,
    set3_a: m.score?.set3_a ?? 0,
    set3_b: m.score?.set3_b ?? 0,
    current_set: m.score?.current_set ?? 1,
    status: defaultStatus,
    winner_id: m.winner_id || '',
    force: !!m.ratings_applied,
  }
}

function hhmmFromIso(iso?: string | null) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

export default function OrganiserScoreModal({
  match,
  scoringMode = 'SIMPLE',
  courtCount = 8,
  eventDateIso,
  slug,
  onClose,
  onSaved,
}: {
  match: Match
  scoringMode?: OrganiserScoringMode | string
  courtCount?: number
  /** YYYY-MM-DD preferred when changing time */
  eventDateIso?: string | null
  slug?: string
  onClose: () => void
  onSaved?: (toast: string) => void
}) {
  const qc = useQueryClient()
  const simple = (scoringMode || 'SIMPLE').toUpperCase() !== 'BEST_OF_3'
  const [form, setForm] = useState<ScoreForm>(() => formFromMatch(match))
  const [error, setError] = useState('')
  const [moveCourt, setMoveCourt] = useState(match.court_number ?? 1)
  const [moveTime, setMoveTime] = useState(hhmmFromIso(match.scheduled_start))
  const [moveError, setMoveError] = useState('')

  useKeyboardInset(true)
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        scrollFieldAboveKeyboard(t)
      }
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  useEffect(() => {
    setForm(formFromMatch(match))
    setMoveCourt(match.court_number ?? 1)
    setMoveTime(hhmmFromIso(match.scheduled_start))
    setError('')
    setMoveError('')
  }, [match])

  const softInvalidate = () => {
    window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ['org-matches'] })
      void qc.invalidateQueries({ queryKey: ['player-view'] })
      void qc.invalidateQueries({ queryKey: ['display'] })
      if (slug) void qc.invalidateQueries({ queryKey: ['matches', slug] })
      else void qc.invalidateQueries({ queryKey: ['matches'] })
    }, 900)
    window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ['rankings'] })
      void qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
    }, 2200)
  }

  const orgMatchesKey = ['org-matches', slug] as const
  const matchesListKey = ['matches', slug] as const

  const patchCaches = (updated: Match, form: ScoreForm) => {
    const winnerName =
      form.winner_id === match.team_a_id
        ? match.team_a_name || 'Winner'
        : form.winner_id === match.team_b_id
          ? match.team_b_name || 'Winner'
          : 'Winner'
    const patchList = (old: unknown) => {
      if (!Array.isArray(old)) return old
      let next = (old as Match[]).map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
      if (
        (form.status === 'COMPLETED' || form.status === 'WALKOVER') &&
        form.winner_id &&
        match.next_match_id &&
        match.next_match_slot
      ) {
        next = next.map((m) => {
          if (m.id !== match.next_match_id) return m
          if (m.status === 'COMPLETED' || m.status === 'WALKOVER' || m.status === 'CANCELLED') {
            return m
          }
          if (match.next_match_slot === 'A') {
            return {
              ...m,
              team_a_id: form.winner_id,
              team_a_name: winnerName,
              team_a_placeholder: null,
            }
          }
          return {
            ...m,
            team_b_id: form.winner_id,
            team_b_name: winnerName,
            team_b_placeholder: null,
          }
        })
      }
      return next
    }
    qc.setQueryData(orgMatchesKey, patchList)
    if (slug) qc.setQueryData(matchesListKey, patchList)
  }

  const scoreMut = useMutation({
    mutationFn: async (payload: ScoreForm) => {
      const current_set = simple ? 1 : resolveCurrentSet(payload)
      return (
        await tournamentApi.updateScore(match.id, {
          set1_a: payload.set1_a,
          set1_b: payload.set1_b,
          set2_a: simple ? 0 : payload.set2_a,
          set2_b: simple ? 0 : payload.set2_b,
          set3_a: simple ? 0 : payload.set3_a,
          set3_b: simple ? 0 : payload.set3_b,
          current_set,
          status: payload.status,
          winner_id: payload.winner_id || null,
          force: payload.force || !!match.ratings_applied,
        })
      ).data
    },
    onMutate: async (payload) => {
      void hapticSuccess()
      setError('')
      await qc.cancelQueries({ queryKey: ['org-matches'] })
      if (slug) await qc.cancelQueries({ queryKey: matchesListKey })
      const prevOrg = qc.getQueryData(orgMatchesKey)
      const prevMatches = slug ? qc.getQueryData(matchesListKey) : undefined
      const pending: Match = {
        ...match,
        status: payload.status,
        winner_id: payload.winner_id || null,
        score: {
          set1_a: payload.set1_a,
          set1_b: payload.set1_b,
          set2_a: payload.set2_a,
          set2_b: payload.set2_b,
          set3_a: payload.set3_a,
          set3_b: payload.set3_b,
          current_set: payload.current_set || 1,
        },
      }
      patchCaches(pending, payload)
      return { prevOrg, prevMatches }
    },
    onSuccess: (data, vars) => {
      patchCaches(data, vars)
      softInvalidate()
      const name =
        vars.winner_id === match.team_a_id
          ? match.team_a_name || 'Team A'
          : vars.winner_id === match.team_b_id
            ? match.team_b_name || 'Team B'
            : null
      const toast =
        vars.status === 'SCHEDULED'
          ? 'Result cleared'
          : name
            ? `${name} wins — bracket updated`
            : 'Score saved'
      onSaved?.(toast)
      onClose()
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.prevOrg !== undefined) qc.setQueryData(orgMatchesKey, ctx.prevOrg)
      if (ctx?.prevMatches !== undefined) qc.setQueryData(matchesListKey, ctx.prevMatches)
      softInvalidate()
      setError(apiErrorMessage(e, 'Could not save score'))
    },
  })

  const moveMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await tournamentApi.moveMatch(match.id, data)).data as Match,
    onSuccess: (data) => {
      if (data?.id) patchCaches(data, form)
      softInvalidate()
      onSaved?.('Court / time updated')
      setMoveError('')
    },
    onError: (e: unknown) => {
      setMoveError(apiErrorMessage(e, 'Could not move match'))
    },
  })

  const canScore = !!(match.team_a_id && match.team_b_id)
  const winnerName =
    form.winner_id === match.team_a_id
      ? match.team_a_name || 'Team A'
      : form.winner_id === match.team_b_id
        ? match.team_b_name || 'Team B'
        : null
  const hasAnyScore = !!(
    form.set1_a ||
    form.set1_b ||
    form.set2_a ||
    form.set2_b ||
    form.set3_a ||
    form.set3_b
  )
  const correcting =
    match.status === 'COMPLETED' || match.status === 'WALKOVER' || !!match.ratings_applied

  const saveScore = (override?: Partial<ScoreForm>) => {
    const next = { ...form, ...override }
    setError('')
    if (!canScore) {
      setError('Both teams need to be set before scoring.')
      return
    }
    if (next.status === 'COMPLETED' || next.status === 'WALKOVER') {
      if (simple) {
        if (!next.winner_id) {
          setError('Tap who won.')
          return
        }
        if (next.set1_a === next.set1_b && (next.set1_a > 0 || next.set1_b > 0)) {
          setError('Score can’t be tied — change it or leave both at 0.')
          return
        }
      } else if (next.status === 'COMPLETED') {
        const tally = tallySets(next)
        if (!tally.ok) {
          setError(tally.reason)
          return
        }
        if (!next.winner_id) {
          if (tally.played < 2) {
            setError('Enter at least two sets, or pick a winner.')
            return
          }
          if (Math.max(tally.aSets, tally.bSets) < 2) {
            setError('One side needs two sets to win, or pick a winner.')
            return
          }
        }
        if (
          tally.ok &&
          ((tally.aSets === 2 && tally.bSets === 0) || (tally.bSets === 2 && tally.aSets === 0)) &&
          (next.set3_a || next.set3_b)
        ) {
          setError('Clear set 3 when the match finished 2–0')
          return
        }
      } else if (!next.winner_id) {
        setError('Pick a winner for the walkover.')
        return
      }
    }
    const run = () => scoreMut.mutate(next)
    if (correcting && next.status !== 'SCHEDULED') {
      void confirmDialog({
        title: 'Correct this result?',
        message: match.ratings_applied
          ? 'Standings and the bracket will update. Ireland ratings already applied stay as first recorded.'
          : 'This replaces the saved result and updates standings / the next round.',
        confirmLabel: 'Save correction',
      }).then((ok) => {
        if (ok) run()
      })
      return
    }
    run()
  }

  const pickWinner = (teamId: string) => {
    if (!teamId) return
    if (
      form.winner_id === teamId &&
      (form.status === 'COMPLETED' || form.status === 'WALKOVER')
    ) {
      saveScore()
      return
    }
    setForm({
      ...form,
      winner_id: teamId,
      status: form.status === 'WALKOVER' ? 'WALKOVER' : 'COMPLETED',
    })
    setError('')
  }

  const clearResult = () => {
    void confirmDialog({
      title: 'Clear this result?',
      message: match.ratings_applied
        ? 'Match goes back to the queue. Standings/bracket update; Ireland ratings already applied stay as first recorded.'
        : 'Match goes back to the queue and the next round slot is cleared if still open.',
      confirmLabel: 'Clear result',
    }).then((ok) => {
      if (!ok) return
      scoreMut.mutate({
        ...form,
        set1_a: 0,
        set1_b: 0,
        set2_a: 0,
        set2_b: 0,
        set3_a: 0,
        set3_b: 0,
        current_set: 1,
        status: 'SCHEDULED',
        winner_id: '',
        force: true,
      })
    })
  }

  const saveMove = () => {
    setMoveError('')
    const data: Record<string, unknown> = { court_number: moveCourt }
    if (moveTime) {
      const datePart =
        eventDateIso ||
        (match.scheduled_start ? String(match.scheduled_start).slice(0, 10) : null) ||
        new Date().toISOString().slice(0, 10)
      data.scheduled_start = new Date(`${datePart}T${moveTime}:00`).toISOString()
    }
    moveMut.mutate(data)
  }

  const courts = Array.from({ length: Math.max(1, courtCount) }, (_, i) => i + 1)
  const title =
    match.ratings_applied || match.status === 'COMPLETED' || match.status === 'WALKOVER'
      ? 'Correct result'
      : match.status === 'AWAITING_CONFIRM'
        ? 'Confirm score'
        : canScore
          ? 'Who won?'
          : 'Match details'

  return (
    <div
      className="modal-backdrop score-modal-backdrop org-score-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="score-modal pl-score-sheet org-score-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-score-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="org-score-title">{title}</h2>
        <p className="muted-note" style={{ marginTop: 0 }}>
          {knockoutRoundLabel(match.round, match.stage)}
          {' · '}
          {courtLabel(match.court_name, match.court_number)}
          {match.scheduled_start ? ` · ${formatTime(match.scheduled_start)}` : ''}
        </p>

        {!canScore ? (
          <p className="muted-note">Waiting on a previous round. You can still move court or time.</p>
        ) : (
          <>
            <p className="muted-note" style={{ marginTop: 0 }}>
              Tap who won. Score optional.
            </p>
            <div className="score-team-grid" role="group" aria-label="Who won">
              <div
                className={`score-team-card ${
                  form.winner_id === match.team_a_id ? 'is-winner' : ''
                }`}
              >
                <button
                  type="button"
                  className="score-team-win"
                  onClick={() => pickWinner(match.team_a_id || '')}
                >
                  <span className="score-team-win-label">
                    {form.winner_id === match.team_a_id ? 'Winner · tap again' : 'Tap if won'}
                  </span>
                  <strong>{match.team_a_name || 'Team A'}</strong>
                </button>
                {simple && (
                  <div className="score-team-points">
                    <span className="score-team-points-label">Score</span>
                    <ScoreStep
                      label={`${match.team_a_name || 'Team A'} score`}
                      value={form.set1_a}
                      max={99}
                      onChange={(n) => {
                        const next = { ...form, set1_a: n, status: 'COMPLETED' }
                        if (n > form.set1_b) next.winner_id = match.team_a_id || ''
                        else if (n < form.set1_b) next.winner_id = match.team_b_id || ''
                        setForm(next)
                      }}
                    />
                  </div>
                )}
              </div>
              <div
                className={`score-team-card ${
                  form.winner_id === match.team_b_id ? 'is-winner' : ''
                }`}
              >
                <button
                  type="button"
                  className="score-team-win"
                  onClick={() => pickWinner(match.team_b_id || '')}
                >
                  <span className="score-team-win-label">
                    {form.winner_id === match.team_b_id
                      ? 'Winner · tap again'
                      : 'Tap if won'}
                  </span>
                  <strong>{match.team_b_name || 'Team B'}</strong>
                </button>
                {simple && (
                  <div className="score-team-points">
                    <span className="score-team-points-label">Score</span>
                    <ScoreStep
                      label={`${match.team_b_name || 'Team B'} score`}
                      value={form.set1_b}
                      max={99}
                      onChange={(n) => {
                        const next = { ...form, set1_b: n, status: 'COMPLETED' }
                        if (n > form.set1_a) next.winner_id = match.team_b_id || ''
                        else if (n < form.set1_a) next.winner_id = match.team_a_id || ''
                        setForm(next)
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="org-score-meta">
              <button
                type="button"
                className={`btn btn-sm ${form.status === 'WALKOVER' ? 'btn-dark' : 'btn-ghost'}`}
                onClick={() =>
                  setForm({
                    ...form,
                    status: form.status === 'WALKOVER' ? 'COMPLETED' : 'WALKOVER',
                  })
                }
              >
                Walkover
              </button>
              {winnerName && !hasAnyScore ? (
                <span className="muted-note org-score-hint">
                  No score — {winnerName} still advances.
                </span>
              ) : null}
            </div>
            {!simple && (
              <details className="org-score-sets" open={hasAnyScore}>
                <summary>Set scores (optional)</summary>
                <div className="score-sides-label">
                  <div>
                    <span className="muted-note">A</span>
                    <strong>{match.team_a_name || 'Team A'}</strong>
                  </div>
                  <div>
                    <span className="muted-note">B</span>
                    <strong>{match.team_b_name || 'Team B'}</strong>
                  </div>
                </div>
                <div className="score-grid">
                  {(
                    [
                      ['set1_a', 'set1_b', 'Set 1', 1] as const,
                      ['set2_a', 'set2_b', 'Set 2', 2] as const,
                      ...(form.set3_a > 0 ||
                      form.set3_b > 0 ||
                      form.current_set >= 3 ||
                      (form.set1_a !== form.set1_b &&
                        form.set2_a !== form.set2_b &&
                        (form.set1_a > form.set1_b) !== (form.set2_a > form.set2_b))
                        ? ([['set3_a', 'set3_b', 'Set 3', 3]] as const)
                        : []),
                    ] as const
                  ).map(([ka, kb, label, setNum]) => {
                    const isDecider = label === 'Set 3'
                    const maxGames = isDecider ? 15 : 7
                    return (
                      <div key={label} className="form-group pl-score-row">
                        <label>{isDecider ? 'Set 3 / TB' : label}</label>
                        <div className="score-pair pl-score-pair">
                          <ScoreStep
                            label={`${label} side A`}
                            value={form[ka]}
                            max={maxGames}
                            onChange={(n) =>
                              setForm({
                                ...form,
                                [ka]: n,
                                current_set: Math.max(form.current_set, setNum),
                              })
                            }
                          />
                          <span className="pl-score-dash">–</span>
                          <ScoreStep
                            label={`${label} side B`}
                            value={form[kb]}
                            max={maxGames}
                            onChange={(n) =>
                              setForm({
                                ...form,
                                [kb]: n,
                                current_set: Math.max(form.current_set, setNum),
                              })
                            }
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}
          </>
        )}

        <details className="org-score-sets" style={{ marginTop: '0.85rem' }}>
          <summary>Court &amp; time</summary>
          <div className="form-group">
            <label className="form-label">Court</label>
            <select
              className="form-select"
              value={moveCourt}
              onChange={(e) => setMoveCourt(Number(e.target.value))}
            >
              {courts.map((n) => (
                <option key={n} value={n}>
                  Court {n}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Start time</label>
            <input
              className="form-input"
              type="time"
              value={moveTime}
              onChange={(e) => setMoveTime(e.target.value)}
            />
          </div>
          {moveError ? <p className="auth-error">{moveError}</p> : null}
          <button
            type="button"
            className="btn btn-dark btn-sm"
            disabled={moveMut.isPending}
            onClick={saveMove}
          >
            {moveMut.isPending ? 'Saving…' : 'Save court / time'}
          </button>
        </details>

        {match.ratings_applied ? (
          <p className="muted-note" style={{ margin: '0.75rem 0 0' }}>
            Ratings already applied — this corrects standings and the bracket only.
          </p>
        ) : null}
        {error ? <p className="auth-error">{error}</p> : null}

        <div className="modal-actions pl-score-actions">
          {canScore ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => saveScore()}
              disabled={
                scoreMut.isPending ||
                ((form.status === 'COMPLETED' || form.status === 'WALKOVER') &&
                  !form.winner_id &&
                  simple)
              }
            >
              {scoreMut.isPending
                ? 'Saving…'
                : correcting
                  ? winnerName
                    ? `Save · ${winnerName} wins`
                    : 'Save correction'
                  : !winnerName
                    ? !simple && hasAnyScore
                      ? 'Save result'
                      : 'Tap who won'
                    : hasAnyScore
                      ? `Save · ${winnerName} wins`
                      : `Save · ${winnerName} wins (no score)`}
            </button>
          ) : null}
          {(match.status === 'COMPLETED' ||
            match.status === 'WALKOVER' ||
            match.status === 'AWAITING_CONFIRM') &&
          canScore ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={clearResult}
              disabled={scoreMut.isPending}
            >
              Clear result
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
