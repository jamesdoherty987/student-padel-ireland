import { useEffect, useMemo, useState } from 'react'
import type { TournamentTeam } from '../services/api'
import ModalShell from './ModalShell'
import {
  formatGroupSizes,
  knockoutRoundLabel,
  liveDrawStats,
  type DrawPreview,
} from '../utils/drawPreview'
import {
  SEEDING_MODE_OPTIONS,
  buildGroupAssignment,
  groupLetter,
  validateGroupAssignment,
  type SeedingMode,
} from '../utils/groupSeeding'
import { bracketFormatHint, tournamentFormatSummary } from '../utils/format'
import './GenerateDrawModal.css'

type Props = {
  open: boolean
  fixturesExist: boolean
  isSingles: boolean
  playFormat: string
  format: string
  enablePlate: boolean
  groupSize?: number
  teamsAdvancePerGroup?: number
  championshipSize?: number
  plateSize?: number
  paidTeams: TournamentTeam[]
  unpaidCount: number
  collectCount: number
  maxTeams: number
  drawPreview: DrawPreview | null
  generateBlockedReason: string | null
  isPending: boolean
  onClose: () => void
  onGenerate: (payload: {
    seeding_mode: SeedingMode
    manual_groups: string[][]
    random_seed?: number
  }) => void
}

export default function GenerateDrawModal({
  open,
  fixturesExist,
  isSingles,
  playFormat,
  format,
  enablePlate,
  groupSize = 4,
  teamsAdvancePerGroup = 2,
  championshipSize = 16,
  plateSize = 16,
  paidTeams,
  unpaidCount,
  collectCount,
  maxTeams,
  drawPreview,
  generateBlockedReason,
  isPending,
  onClose,
  onGenerate,
}: Props) {
  const isRoundRobin = format === 'ROUND_ROBIN'
  const preferredGroupSize = Math.max(2, groupSize || 4)
  const entryLabel = isSingles ? 'player' : 'team'
  const entryLabelPlural = isSingles ? 'players' : 'teams'

  const [seedingMode, setSeedingMode] = useState<SeedingMode>('alphabetical')
  const [groups, setGroups] = useState<string[][]>([])
  const [unassigned, setUnassigned] = useState<string[]>([])
  const [activeGroup, setActiveGroup] = useState<number | null>(0)
  const [randomSeed, setRandomSeed] = useState(() => Date.now())
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  const teamById = useMemo(() => {
    const map = new Map<string, TournamentTeam>()
    for (const t of paidTeams) map.set(t.id, t)
    return map
  }, [paidTeams])

  const applySeeding = (mode: SeedingMode, seed = Date.now()) => {
    const next = buildGroupAssignment(paidTeams, mode, preferredGroupSize, seed)
    setGroups(next.groups)
    setUnassigned(next.unassigned)
    setSelectedTeamId(null)
    setActiveGroup(next.groups.length ? 0 : null)
    setRandomSeed(seed)
  }

  const paidIdsKey = paidTeams.map((t) => t.id).join('|')
  useEffect(() => {
    if (!open) return
    setSeedingMode('alphabetical')
    applySeeding('alphabetical')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when modal opens / field changes
  }, [open, paidIdsKey, preferredGroupSize])

  const filledGroups = useMemo(() => groups.filter((g) => g.length > 0), [groups])
  const liveSizes = useMemo(() => filledGroups.map((g) => g.length), [filledGroups])

  const liveStats = useMemo(() => {
    if (isRoundRobin) {
      return liveDrawStats({
        groupSizes: [paidTeams.length],
        format: 'ROUND_ROBIN',
      })
    }
    if (!liveSizes.length) {
      return drawPreview?.ok
        ? {
            ok: true as const,
            groupCount: drawPreview.groupCount,
            groupSizes: drawPreview.groupSizes,
            groupMatches: drawPreview.groupMatches,
            advancePerGroup: drawPreview.advancePerGroup,
            advanceAdjusted: drawPreview.advanceAdjusted,
            requestedAdvance: drawPreview.requestedAdvance,
            byeSlots: drawPreview.byeSlots,
            knockoutRounds: drawPreview.knockoutRounds,
            plateRounds: drawPreview.plateRounds,
            enablePlate: drawPreview.enablePlate,
            championshipSize: drawPreview.championshipSize,
            plateSize: drawPreview.plateSize,
            totalMatches: drawPreview.totalMatches,
            note: drawPreview.note,
          }
        : null
    }
    return liveDrawStats({
      groupSizes: liveSizes,
      teamsAdvancePerGroup,
      format,
      enablePlate,
      championshipSize,
      plateSize,
    })
  }, [
    isRoundRobin,
    paidTeams.length,
    liveSizes,
    drawPreview,
    teamsAdvancePerGroup,
    format,
    enablePlate,
    championshipSize,
    plateSize,
  ])

  const assignmentError = isRoundRobin
    ? null
    : validateGroupAssignment(
        paidTeams.map((t) => t.id),
        groups,
        unassigned,
      )

  const liveBlocked =
    liveStats && !liveStats.ok ? liveStats.error || 'Draw settings look invalid' : null
  const blockedReason = generateBlockedReason || assignmentError || liveBlocked
  const canSubmit = !blockedReason && !isPending && paidTeams.length >= 2

  const moveTeam = (teamId: string, toGroup: number | 'unassigned') => {
    setUnassigned((prev) => {
      const without = prev.filter((id) => id !== teamId)
      return toGroup === 'unassigned' ? [...without, teamId] : without
    })
    setGroups((prev) => {
      const next = prev.map((g) => g.filter((id) => id !== teamId))
      if (toGroup !== 'unassigned') {
        while (next.length <= toGroup) next.push([])
        next[toGroup] = [...next[toGroup], teamId]
      }
      return next
    })
    if (toGroup !== 'unassigned') setActiveGroup(toGroup)
    setSelectedTeamId(null)
    setSeedingMode('manual')
  }

  const placeSelectedInto = (groupIndex: number) => {
    if (!selectedTeamId) {
      setActiveGroup(groupIndex)
      return
    }
    moveTeam(selectedTeamId, groupIndex)
  }

  const clearToManual = () => {
    setSeedingMode('manual')
    applySeeding('manual')
  }

  const addEmptyGroup = () => {
    setGroups((prev) => [...prev, []])
    setSeedingMode('manual')
  }

  const removeEmptyGroup = (index: number) => {
    if (groups[index]?.length) return
    setGroups((prev) => prev.filter((_, i) => i !== index))
    setActiveGroup((cur) => {
      if (cur == null) return cur
      if (cur === index) return Math.max(0, index - 1)
      if (cur > index) return cur - 1
      return cur
    })
    setSeedingMode('manual')
  }

  const seedingHint = (() => {
    if (seedingMode === 'manual' && filledGroups.length > 0) {
      return 'Groups are under your control — select a team, then tap a group, or use Move.'
    }
    return SEEDING_MODE_OPTIONS.find((o) => o.value === seedingMode)?.hint || ''
  })()

  const renderTeamChip = (teamId: string, from: number | 'unassigned') => {
    const team = teamById.get(teamId)
    if (!team) return null
    const selected = selectedTeamId === teamId
    const showPlayers =
      !!team.player_names?.length &&
      !(
        isSingles &&
        team.player_names.length === 1 &&
        team.player_names[0].toLowerCase() === team.name.toLowerCase()
      )

    return (
      <div
        key={teamId}
        className={`org-draw-chip${selected ? ' is-selected' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => setSelectedTeamId(selected ? null : teamId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setSelectedTeamId(selected ? null : teamId)
          }
        }}
      >
        <div className="org-draw-chip-main">
          <strong>{team.name}</strong>
          {team.university_short ? <span className="org-draw-chip-uni">{team.university_short}</span> : null}
          {showPlayers ? <span className="org-draw-chip-players">{team.player_names.join(' / ')}</span> : null}
        </div>
        <label className="org-draw-chip-move" onClick={(e) => e.stopPropagation()}>
          <select
            aria-label={`Move ${team.name}`}
            value={from === 'unassigned' ? 'unassigned' : String(from)}
            onChange={(e) => {
              const v = e.target.value
              moveTeam(teamId, v === 'unassigned' ? 'unassigned' : Number(v))
            }}
            disabled={isPending}
          >
            <option value="unassigned">Unassigned</option>
            {groups.map((_, i) => (
              <option key={i} value={i}>
                Group {groupLetter(i)}
              </option>
            ))}
          </select>
        </label>
      </div>
    )
  }

  if (!open) return null

  return (
    <ModalShell
      title={fixturesExist ? 'Re-generate draw?' : 'Generate draw?'}
      titleId="generate-modal-title"
      wide
      className="modal-draw"
      preventClose={isPending}
      onClose={onClose}
      subtitle={
        isRoundRobin ? (
          <>
            Builds fixtures from <strong>paid</strong> entries only so everyone plays everyone.
            Registration will close.
          </>
        ) : (
          <>
            Builds groups, fixtures, and the knockout from <strong>paid</strong> entries only.
            Choose a placement, then tweak groups below. Registration will close.
          </>
        )
      }
      footer={
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => {
              const nonEmpty = groups.filter((g) => g.length > 0)
              onGenerate({
                seeding_mode: isRoundRobin ? 'alphabetical' : seedingMode,
                manual_groups: isRoundRobin ? [paidTeams.map((t) => t.id)] : nonEmpty,
                random_seed: seedingMode === 'random' ? randomSeed : undefined,
              })
            }}
          >
            {isPending ? 'Generating…' : fixturesExist ? 'Replace draw' : 'Generate draw'}
          </button>
        </div>
      }
    >
      {fixturesExist && (
        <p className="org-gen-warn" role="alert">
          Existing matches and groups will be replaced.
        </p>
      )}
      <p className="org-gen-meta">
        {tournamentFormatSummary(playFormat, format)}. {bracketFormatHint(format, enablePlate)}
      </p>

      <div className="org-gen-stats">
        <div>
          <span>Paid entries</span>
          <strong>
            {paidTeams.length}
            {maxTeams > 0 ? ` / ${maxTeams}` : ''}
          </strong>
        </div>
        {unpaidCount > 0 && (
          <div>
            <span>Not paid (excluded)</span>
            <strong>{unpaidCount}</strong>
          </div>
        )}
        {collectCount > 0 && (
          <div>
            <span>Pay on arrival (in draw)</span>
            <strong>{collectCount}</strong>
          </div>
        )}
        {liveStats?.ok && (
          <>
            <div>
              <span>Groups</span>
              <strong>
                {liveStats.groupCount}{' '}
                <span className="org-gen-sub">({formatGroupSizes(liveStats.groupSizes)})</span>
              </strong>
            </div>
            <div>
              <span>Matches</span>
              <strong>{liveStats.totalMatches}</strong>
            </div>
          </>
        )}
      </div>

      {paidTeams.length > 0 && maxTeams > 0 && paidTeams.length < maxTeams && (
        <p className="org-gen-note">
          Field isn’t full ({maxTeams - paidTeams.length} spot
          {maxTeams - paidTeams.length === 1 ? '' : 's'} left). That’s fine - groups will be sized
          evenly from the {paidTeams.length} paid {paidTeams.length === 1 ? entryLabel : entryLabelPlural}.
        </p>
      )}

      {!isRoundRobin && (
        <div className="org-draw-seed">
          <div className="org-draw-seed-row">
            <label className="org-draw-seed-label" htmlFor="org-draw-seeding">
              Group placement
            </label>
            <select
              id="org-draw-seeding"
              className="form-input org-draw-seed-select"
              value={seedingMode}
              disabled={isPending}
              onChange={(e) => {
                const mode = e.target.value as SeedingMode
                setSeedingMode(mode)
                applySeeding(mode, Date.now())
              }}
            >
              {SEEDING_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={isPending || seedingMode === 'manual'}
              onClick={() => applySeeding(seedingMode, Date.now())}
            >
              {seedingMode === 'random' ? 'Shuffle again' : 'Re-apply'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={isPending} onClick={clearToManual}>
              Clear & place manually
            </button>
          </div>
          <p className="org-draw-seed-hint">
            {seedingHint}
            {selectedTeamId ? ' Selected team ready — tap a group to place it.' : ''}
          </p>
        </div>
      )}

      {!isRoundRobin && (
        <div className="org-draw-board">
          {unassigned.length > 0 && (
            <section className="org-draw-pool">
              <header>
                <h3>Unassigned</h3>
                <span>{unassigned.length}</span>
              </header>
              <div className="org-draw-chip-list">
                {unassigned.map((id) => renderTeamChip(id, 'unassigned'))}
              </div>
            </section>
          )}

          <div className="org-draw-groups">
            {groups.map((teamIds, index) => {
              const isActive = activeGroup === index
              const canDrop = !!selectedTeamId
              return (
                <section
                  key={index}
                  className={`org-draw-group${isActive ? ' is-active' : ''}${canDrop ? ' is-droppable' : ''}`}
                  onClick={() => placeSelectedInto(index)}
                >
                  <header>
                    <h3>Group {groupLetter(index)}</h3>
                    <span>
                      {teamIds.length} {teamIds.length === 1 ? entryLabel : entryLabelPlural}
                    </span>
                    {!teamIds.length && groups.length > 1 ? (
                      <button
                        type="button"
                        className="org-draw-group-remove"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeEmptyGroup(index)
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </header>
                  {teamIds.length === 0 ? (
                    <p className="org-draw-empty">
                      {selectedTeamId ? 'Tap to place selected team' : 'Empty — select a team to add'}
                    </p>
                  ) : (
                    <div className="org-draw-chip-list" onClick={(e) => e.stopPropagation()}>
                      {teamIds.map((id) => renderTeamChip(id, index))}
                    </div>
                  )}
                  {canDrop ? (
                    <button
                      type="button"
                      className="org-draw-drop-zone"
                      onClick={(e) => {
                        e.stopPropagation()
                        placeSelectedInto(index)
                      }}
                    >
                      Move here
                    </button>
                  ) : null}
                </section>
              )
            })}
          </div>
          <div className="org-draw-board-actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={isPending} onClick={addEmptyGroup}>
              Add group
            </button>
          </div>
        </div>
      )}

      {liveStats?.ok && !isRoundRobin && (
        <ul className="org-gen-list">
          {liveStats.enablePlate ? (
            <>
              <li>
                {liveStats.championshipSize} teams → Championship
                {liveStats.knockoutRounds.length
                  ? ` (${liveStats.knockoutRounds.map(knockoutRoundLabel).join(' → ')})`
                  : ''}
              </li>
              <li>
                {liveStats.plateSize} teams → Plate
                {liveStats.plateRounds.length
                  ? ` (${liveStats.plateRounds.map(knockoutRoundLabel).join(' → ')})`
                  : ''}
              </li>
            </>
          ) : (
            <>
              <li>
                Top {liveStats.advancePerGroup} per group advance
                {liveStats.advanceAdjusted
                  ? ` (adjusted from ${liveStats.requestedAdvance} to fit smaller groups)`
                  : ''}
              </li>
              {liveStats.knockoutRounds.length > 0 ? (
                <li>
                  Knockout starts at {knockoutRoundLabel(liveStats.knockoutRounds[0])}
                  {liveStats.byeSlots > 0
                    ? ` · ${liveStats.byeSlots} bye${liveStats.byeSlots === 1 ? '' : 's'} for the bracket`
                    : ''}
                </li>
              ) : (
                <li>{liveStats.note || 'Group stage only'}</li>
              )}
            </>
          )}
        </ul>
      )}

      {blockedReason && (
        <p className="org-gen-warn" role="alert">
          {blockedReason}
        </p>
      )}
    </ModalShell>
  )
}
