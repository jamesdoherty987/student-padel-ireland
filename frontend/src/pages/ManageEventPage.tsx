import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { ShareQr } from '../components/ShareQr'
import { confirmDialog } from '../components/ConfirmDialog'
import EditTournamentModal from '../components/EditTournamentModal'
import ScoreStep from '../components/ScoreStep'
import SponsorStrip from '../components/SponsorStrip'
import TournamentBracket from '../components/TournamentBracket'
import GenerateDrawModal from '../components/GenerateDrawModal'
import '../components/ScoreSheet.css'
import { useAuth } from '../context/AuthContext'
import { scrollFieldAboveKeyboard, useKeyboardInset } from '../hooks/useKeyboardInset'
import { hapticLight, hapticSuccess } from '../native/haptics'
import { publicPathUrl } from '../native/platform'
import {
  apiErrorMessage,
  communityApi,
  platformApi,
  tournamentApi,
  type Match,
  type ManageDashRow,
  type PlayerSearch,
  type TournamentTeam,
} from '../services/api'
import {
  formatGroupSizes,
  previewDraw,
} from '../utils/drawPreview'
import {
  calendarDaysFromToday,
  courtLabel,
  formatDateTime,
  formatMatchScore,
  formatMoney,
  formatTime,
  isKnockoutActive,
  knockoutRoundLabel,
  matchPathLabel,
  statusBadgeClass,
  statusLabel,
} from '../utils/format'
import { mediaUrl } from '../utils/media'
import './ManageEvent.css'

type OrgPanel = 'registration' | 'day-of' | 'settings'

function defaultOrgPanel(status: string, hasFixtures: boolean): OrgPanel {
  if (status === 'LIVE' || hasFixtures) return 'day-of'
  if (status === 'COMPLETED' || status === 'CANCELLED') return 'day-of'
  return 'registration'
}

/** Best-of-3 set tallies for admin score validation. */
function tallySets(form: {
  set1_a: number
  set1_b: number
  set2_a: number
  set2_b: number
  set3_a: number
  set3_b: number
}) {
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

/** Respect selected set; only bump when a higher set already has games. */
function resolveCurrentSet(form: {
  set1_a: number
  set1_b: number
  set2_a: number
  set2_b: number
  set3_a: number
  set3_b: number
  current_set: number
}) {
  const selected = Math.min(3, Math.max(1, form.current_set || 1))
  if (form.set3_a || form.set3_b) return 3
  if ((form.set2_a || form.set2_b) && selected < 2) return 2
  return selected
}

export default function ManageEventPage() {
  const { user, loading: authLoading } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params, setSearchParams] = useSearchParams()
  const canOrganise = !!user
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['manage-dashboard'],
    queryFn: async () => (await platformApi.manageDashboard()).data,
    enabled: canOrganise,
  })

  const [toast, setToast] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(params.get('t'))
  const [showEdit, setShowEdit] = useState(false)
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [announce, setAnnounce] = useState({ title: '', body: '' })
  const [sponsorForm, setSponsorForm] = useState({
    name: '',
    website: '',
    featured: false,
    logo: null as File | null,
  })
  const [sponsorPreview, setSponsorPreview] = useState<string | null>(null)
  const [sponsorLogoKey, setSponsorLogoKey] = useState(0)
  const [adminQuery, setAdminQuery] = useState('')
  const [adminResults, setAdminResults] = useState<PlayerSearch[]>([])
  const [adminSearching, setAdminSearching] = useState(false)
  const adminSearchSeq = useRef(0)
  const [scoreMatch, setScoreMatch] = useState<Match | null>(null)
  const [moveMatch, setMoveMatch] = useState<Match | null>(null)
  const [moveForm, setMoveForm] = useState({ court_number: 1, scheduled_time: '' })
  const [matchView, setMatchView] = useState<'list' | 'courts' | 'bracket'>('list')
  const [courtFilter, setCourtFilter] = useState<string>('all')
  const [matchFilter, setMatchFilter] = useState<'now' | 'upcoming' | 'active' | 'all' | 'done'>(
    'all',
  )
  const bracketPreferred = useRef(false)
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'owing'>('all')
  const [entriesCheckInFilter, setEntriesCheckInFilter] = useState<'all' | 'in' | 'out'>('all')
  const [entriesQuery, setEntriesQuery] = useState('')
  const [entriesSort, setEntriesSort] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [checkInFilter, setCheckInFilter] = useState<'all' | 'out' | 'in'>('out')
  const [checkInQuery, setCheckInQuery] = useState('')
  const [orgPanel, setOrgPanel] = useState<OrgPanel>('registration')
  const [scoreForm, setScoreForm] = useState({
    set1_a: 0,
    set1_b: 0,
    set2_a: 0,
    set2_b: 0,
    set3_a: 0,
    set3_b: 0,
    current_set: 1,
    status: 'COMPLETED',
    winner_id: '',
    force: false,
  })
  const [scoreError, setScoreError] = useState('')

  useKeyboardInset(!!scoreMatch)
  useEffect(() => {
    if (!scoreMatch) return
    const onFocus = (e: FocusEvent) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (!t.closest('.score-modal')) return
      if (t.matches('input, textarea, select')) scrollFieldAboveKeyboard(t)
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [scoreMatch])

  useEffect(() => {
    if (params.get('create') === '1') {
      navigate('/admin', { replace: true })
      return
    }
    const t = params.get('t')
    if (t) setSelectedId(t)
  }, [params, navigate])

  useEffect(() => {
    setPaymentFilter('all')
    setEntriesCheckInFilter('all')
    setEntriesQuery('')
    setEntriesSort('newest')
    setCheckInFilter('out')
    setCheckInQuery('')
    setMatchFilter('all')
    setMatchView('list')
    bracketPreferred.current = false
    setSponsorForm({ name: '', website: '', featured: false, logo: null })
    setSponsorLogoKey((k) => k + 1)
  }, [selectedId])

  useEffect(() => {
    const open = showEdit || confirmGenerate || !!scoreMatch || showAddTeam || !!moveMatch
    document.body.classList.toggle('modal-open', open)
    return () => document.body.classList.remove('modal-open')
  }, [showEdit, confirmGenerate, scoreMatch, showAddTeam, moveMatch])

  useEffect(() => {
    // Generate / edit use ModalShell (own Escape). This covers score / add-team / move.
    if (!scoreMatch && !showAddTeam && !moveMatch) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setScoreMatch(null)
      setShowAddTeam(false)
      setMoveMatch(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scoreMatch, showAddTeam, moveMatch])

  const tournaments: ManageDashRow[] = data?.tournaments || []

  const active = selectedId
    ? tournaments.find((t) => t.tournament.id === selectedId) || null
    : tournaments[0] || null
  const tid = active?.tournament.id
  const slug = active?.tournament.slug

  useEffect(() => {
    setAdminQuery('')
    setAdminResults([])
    setAdminSearching(false)
    adminSearchSeq.current += 1
  }, [tid])

  useEffect(() => {
    // Don't wipe a freshly created selection while the dashboard cache is still stale
    if (isLoading || isFetching) return
    if (selectedId && tournaments.length > 0 && !tournaments.some((t) => t.tournament.id === selectedId)) {
      setSelectedId(tournaments[0]?.tournament.id ?? null)
    }
  }, [selectedId, tournaments, isLoading, isFetching])

  const { data: teams = [] } = useQuery({
    queryKey: ['org-teams', tid],
    queryFn: async () => (await tournamentApi.teams(tid!)).data,
    enabled: !!tid && canOrganise,
  })

  const { data: matches = [] } = useQuery({
    queryKey: ['org-matches', slug],
    queryFn: async () => (await tournamentApi.matches(slug!)).data,
    enabled: !!slug && canOrganise,
    refetchInterval: 4000,
  })

  const { data: tournamentDetail } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: async () => (await tournamentApi.get(slug!)).data,
    enabled: !!slug && canOrganise,
  })

  const { data: announcements = [] } = useQuery({
    queryKey: ['announcements', slug],
    queryFn: async () => (await tournamentApi.announcements(slug!)).data,
    enabled: !!slug && canOrganise,
  })

  const { data: sponsors = [] } = useQuery({
    queryKey: ['sponsors', slug],
    queryFn: async () => (await tournamentApi.sponsors(slug!)).data,
    enabled: !!slug && canOrganise,
  })

  const isOwner = active?.is_owner ?? active?.can_manage_admins ?? false

  const { data: tournamentAdmins = [] } = useQuery({
    queryKey: ['tournament-admins', tid],
    queryFn: async () => (await tournamentApi.admins(tid!)).data,
    enabled: !!tid && canOrganise,
  })

  const scoringMode =
    (tournamentDetail?.scoring_mode || 'SIMPLE').toUpperCase() === 'BEST_OF_3'
      ? 'BEST_OF_3'
      : 'SIMPLE'
  const isSingles = (tournamentDetail?.play_format || active?.tournament.play_format) === 'SINGLES'
  const activeFormat =
    tournamentDetail?.format || active?.tournament.format || 'GROUP_KNOCKOUT'
  const activePlayFormat =
    tournamentDetail?.play_format || active?.tournament.play_format || 'DOUBLES'

  const { data: friends = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await communityApi.friends()).data,
    enabled: canOrganise,
  })

  const friendOptions = useMemo(
    () => friends.filter((f) => f.direction === 'friend'),
    [friends],
  )

  const inviteCode = tournamentDetail?.invite_code || ''
  const joinUrl = inviteCode ? publicPathUrl(`/join/${inviteCode}`) : ''

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3200)
  }

  const invalidateTournamentPublic = () => {
    qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
    qc.invalidateQueries({ queryKey: ['tournaments'] })
    qc.invalidateQueries({ queryKey: ['display'] })
    if (slug) {
      qc.invalidateQueries({ queryKey: ['tournament', slug] })
      qc.invalidateQueries({ queryKey: ['matches', slug] })
      qc.invalidateQueries({ queryKey: ['player-view', slug] })
      qc.invalidateQueries({ queryKey: ['announcements', slug] })
      qc.invalidateQueries({ queryKey: ['sponsors', slug] })
    }
  }

  useEffect(() => {
    if (!sponsorForm.logo) {
      setSponsorPreview(null)
      return
    }
    const url = URL.createObjectURL(sponsorForm.logo)
    setSponsorPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [sponsorForm.logo])

  const generateMut = useMutation({
    mutationFn: (payload?: {
      seeding_mode?: string
      manual_groups?: string[][]
      random_seed?: number
    }) => tournamentApi.generate(tid!, payload),
    onSuccess: (res) => {
      setConfirmGenerate(false)
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
      invalidateTournamentPublic()
      const d = res.data as {
        matches?: number
        groups?: number
        group_sizes?: number[]
        bye_slots?: number
        advance_adjusted?: boolean
      }
      const matchesN = d.matches ?? 0
      const groupsN = d.groups ?? 0
      const sizes = d.group_sizes?.length ? ` · groups ${formatGroupSizes(d.group_sizes)}` : ''
      const byes = d.bye_slots ? ` · ${d.bye_slots} KO bye${d.bye_slots === 1 ? '' : 's'}` : ''
      const adjusted = d.advance_adjusted ? ' · advance adjusted for group sizes' : ''
      if (activeFormat === 'ROUND_ROBIN' || groupsN === 0) {
        showToast(`Generated ${matchesN} round-robin match${matchesN === 1 ? '' : 'es'}`)
      } else {
        showToast(`Generated ${groupsN} groups · ${matchesN} matches${sizes}${byes}${adjusted}`)
      }
    },
    onError: (e: unknown) => {
      showToast(apiErrorMessage(e, 'Generate failed. You need at least 2 paid entries.'))
    },
  })

  const openMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'REGISTRATION_OPEN' }),
    onSuccess: () => {
      invalidateTournamentPublic()
      showToast('Registration opened')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not open registration')),
  })

  const closeRegMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'REGISTRATION_CLOSED' }),
    onSuccess: () => {
      invalidateTournamentPublic()
      showToast('Registration closed')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not close registration')),
  })

  const goLiveMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'LIVE' }),
    onSuccess: () => {
      invalidateTournamentPublic()
      showToast('Tournament is now LIVE')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not go live')),
  })

  const completeMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'COMPLETED' }),
    onSuccess: () => {
      invalidateTournamentPublic()
      showToast('Tournament marked completed')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not complete tournament')),
  })

  const cancelMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'CANCELLED' }),
    onSuccess: () => {
      invalidateTournamentPublic()
      showToast('Tournament cancelled')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not cancel tournament')),
  })

  const restoreMut = useMutation({
    mutationFn: () => tournamentApi.update(tid!, { status: 'DRAFT' }),
    onSuccess: () => {
      invalidateTournamentPublic()
      showToast('Restored as draft')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not restore tournament')),
  })

  const deleteMut = useMutation({
    mutationFn: () => tournamentApi.delete(tid!),
    onSuccess: (res) => {
      const deletedId = tid
      qc.setQueryData(['manage-dashboard'], (old: unknown) => {
        const data = old as { tournaments?: Array<{ tournament: { id: string } }> } | undefined
        if (!data?.tournaments || !deletedId) return old
        return {
          ...data,
          tournaments: data.tournaments.filter((row) => row.tournament.id !== deletedId),
        }
      })
      invalidateTournamentPublic()
      qc.removeQueries({ queryKey: ['tournament-admins', deletedId] })
      setSelectedId(null)
      showToast(`Deleted "${res.data.deleted}"`)
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not delete tournament')),
  })

  const transferOwnerMut = useMutation({
    mutationFn: (userId: string) => tournamentApi.update(tid!, { organiser_id: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
      qc.invalidateQueries({ queryKey: ['tournament-admins', tid] })
      qc.invalidateQueries({ queryKey: ['tournament', slug] })
      showToast('Ownership transferred')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not transfer ownership')),
  })

  const announceMut = useMutation({
    mutationFn: (payload: { title: string; body: string }) =>
      tournamentApi.createAnnouncement(tid!, payload),
    onSuccess: () => {
      setAnnounce({ title: '', body: '' })
      qc.invalidateQueries({ queryKey: ['player-view', slug] })
      qc.invalidateQueries({ queryKey: ['announcements', slug] })
      showToast('Announcement posted - visible on player live')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not post announcement')),
  })

  const deleteAnnounceMut = useMutation({
    mutationFn: (announcementId: string) => tournamentApi.deleteAnnouncement(tid!, announcementId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player-view', slug] })
      qc.invalidateQueries({ queryKey: ['announcements', slug] })
      showToast('Announcement deleted')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not delete announcement')),
  })

  const sponsorMut = useMutation({
    mutationFn: (payload: {
      name: string
      website?: string
      featured: boolean
      logo: File | null
    }) => tournamentApi.createSponsor(tid!, payload),
    onSuccess: () => {
      setSponsorForm({ name: '', website: '', featured: false, logo: null })
      setSponsorLogoKey((k) => k + 1)
      qc.invalidateQueries({ queryKey: ['sponsors', slug] })
      showToast('Sponsor added - shown on the tournament page')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not add sponsor')),
  })

  const deleteSponsorMut = useMutation({
    mutationFn: (sponsorId: string) => tournamentApi.deleteSponsor(tid!, sponsorId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sponsors', slug] })
      showToast('Sponsor removed')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not remove sponsor')),
  })

  const addAdminMut = useMutation({
    mutationFn: (userId: string) => tournamentApi.addAdmin(tid!, { user_id: userId }),
    onSuccess: () => {
      setAdminQuery('')
      setAdminResults([])
      qc.invalidateQueries({ queryKey: ['tournament-admins', tid] })
      showToast('Admin added')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not add admin')),
  })

  const removeAdminMut = useMutation({
    mutationFn: (userId: string) => tournamentApi.removeAdmin(tid!, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tournament-admins', tid] })
      showToast('Admin removed')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not remove admin')),
  })

  const searchAdmins = async (q: string) => {
    setAdminQuery(q)
    const seq = ++adminSearchSeq.current
    if (q.trim().length < 2) {
      setAdminResults([])
      setAdminSearching(false)
      return
    }
    setAdminSearching(true)
    try {
      const { data: results } = await communityApi.searchPlayers(q.trim())
      if (seq !== adminSearchSeq.current) return
      const existing = new Set(tournamentAdmins.map((a) => a.user_id))
      setAdminResults(results.filter((p) => !existing.has(p.id)))
    } catch {
      if (seq !== adminSearchSeq.current) return
      setAdminResults([])
    } finally {
      if (seq === adminSearchSeq.current) setAdminSearching(false)
    }
  }

  type ScorePayload = {
    match: Match
    form: typeof scoreForm
    toastOk?: string
  }

  const scoreMut = useMutation({
    mutationFn: ({ match, form }: ScorePayload) => {
      const simple = scoringMode === 'SIMPLE'
      const current_set = simple ? 1 : resolveCurrentSet(form)
      return tournamentApi.updateScore(match.id, {
        set1_a: form.set1_a,
        set1_b: form.set1_b,
        set2_a: simple ? 0 : form.set2_a,
        set2_b: simple ? 0 : form.set2_b,
        set3_a: simple ? 0 : form.set3_a,
        set3_b: simple ? 0 : form.set3_b,
        current_set,
        status: form.status,
        winner_id: form.winner_id || null,
        force: form.force || !!match.ratings_applied,
      })
    },
    onMutate: ({ match }) => {
      void hapticSuccess()
      // Close sheet immediately — match + form are in the mutation vars
      setScoreMatch(null)
      setScoreError('')
      showToast('Saving…')
      return { closed: match }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      qc.invalidateQueries({ queryKey: ['rankings'] })
      qc.invalidateQueries({ queryKey: ['player-view'] })
      qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
      qc.invalidateQueries({ queryKey: ['display'] })
      if (slug) {
        qc.invalidateQueries({ queryKey: ['matches', slug] })
      }
      showToast(vars.toastOk || 'Score saved')
    },
    onError: (e: unknown, _vars, ctx) => {
      const msg = apiErrorMessage(e, 'Could not save score')
      if (ctx?.closed) {
        setScoreMatch(ctx.closed)
        setScoreError(msg)
      }
      showToast(msg)
    },
  })

  const clearScore = () => {
    if (!scoreMatch?.id) {
      setScoreError('Match missing — close and try again.')
      return
    }
    const matchToClear = scoreMatch
    void confirmDialog({
      title: 'Clear this result?',
      message: matchToClear.ratings_applied
        ? 'Match goes back to the queue. Standings/bracket update; Ireland ratings already applied stay as first recorded.'
        : 'Match goes back to the queue and the next round slot is cleared if still open.',
      confirmLabel: 'Clear result',
    }).then((ok) => {
      if (!ok) return
      scoreMut.mutate({
        match: matchToClear,
        form: {
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
        },
        toastOk: 'Result cleared',
      })
    })
  }

  const saveScore = () => {
    if (!scoreMatch?.id) {
      setScoreError('Match missing — close and try again.')
      return
    }
    setScoreError('')
    if (scoreForm.status === 'COMPLETED' || scoreForm.status === 'WALKOVER') {
      if (scoringMode === 'SIMPLE') {
        if (!scoreForm.winner_id) {
          setScoreError('Tap who won.')
          return
        }
        if (
          scoreForm.set1_a === scoreForm.set1_b &&
          (scoreForm.set1_a > 0 || scoreForm.set1_b > 0)
        ) {
          setScoreError('Score can’t be tied — change it or leave both at 0.')
          return
        }
      } else if (scoreForm.status === 'COMPLETED') {
        const tally = tallySets(scoreForm)
        if (!tally.ok) {
          setScoreError(tally.reason)
          return
        }
        const hasWinner = !!scoreForm.winner_id
        if (!hasWinner) {
          if (tally.played < 2) {
            setScoreError('Enter at least two sets, or pick a winner.')
            return
          }
          if (Math.max(tally.aSets, tally.bSets) < 2) {
            setScoreError('One side needs two sets to win, or pick a winner.')
            return
          }
        }
        if (
          tally.ok &&
          ((tally.aSets === 2 && tally.bSets === 0) || (tally.bSets === 2 && tally.aSets === 0)) &&
          (scoreForm.set3_a || scoreForm.set3_b)
        ) {
          setScoreError('Clear set 3 when the match finished 2–0')
          return
        }
      } else if (!scoreForm.winner_id) {
        setScoreError('Pick a winner for the walkover.')
        return
      }
    }
    const matchToSave = scoreMatch
    const formToSave = { ...scoreForm }
    const correcting =
      matchToSave.status === 'COMPLETED' ||
      matchToSave.status === 'WALKOVER' ||
      !!matchToSave.ratings_applied
    if (correcting) {
      void confirmDialog({
        title: 'Correct this result?',
        message: matchToSave.ratings_applied
          ? 'Standings and the bracket will update. Ireland ratings already applied for this match are not recalculated.'
          : 'This replaces the saved result and updates standings / the next round.',
        confirmLabel: 'Save correction',
      }).then((ok) => {
        if (ok) scoreMut.mutate({ match: matchToSave, form: formToSave })
      })
      return
    }
    scoreMut.mutate({ match: matchToSave, form: formToSave })
  }

  const moveMut = useMutation({
    mutationFn: ({
      matchId,
      data,
    }: {
      matchId: string
      data: Record<string, unknown>
      silent?: boolean
    }) => tournamentApi.moveMatch(matchId, data),
    onMutate: async () => {
      void hapticLight()
      setMoveMatch(null)
      return {}
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      qc.invalidateQueries({ queryKey: ['player-view'] })
      qc.invalidateQueries({ queryKey: ['display'] })
      if (slug) {
        qc.invalidateQueries({ queryKey: ['matches', slug] })
      }
      if (!vars.silent) {
        if (vars.data?.notify_only) {
          showToast('Players emailed')
        } else {
          showToast('Updated')
        }
      }
    },
    onError: (e: unknown) => {
      showToast(apiErrorMessage(e, 'Could not update match'))
    },
  })

  const checkInMut = useMutation({
    mutationFn: ({ teamId, present }: { teamId: string; present: boolean }) =>
      tournamentApi.checkIn(tid!, teamId, {
        player1_present: present,
        player2_present: present,
      }),
    onMutate: async (vars) => {
      void hapticLight()
      await qc.cancelQueries({ queryKey: ['org-teams', tid] })
      const prev = qc.getQueryData<TournamentTeam[]>(['org-teams', tid])
      qc.setQueryData<TournamentTeam[]>(['org-teams', tid], (old) =>
        (old || []).map((t) => (t.id === vars.teamId ? { ...t, checked_in: vars.present } : t)),
      )
      return { prev }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['org-teams'] })
      qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
      showToast(vars.present ? 'Checked in' : 'Undone')
    },
    onError: (e: unknown, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['org-teams', tid], ctx.prev)
      showToast(apiErrorMessage(e, 'Check-in failed'))
    },
  })

  const remindMut = useMutation({
    mutationFn: () => tournamentApi.sendReminders(tid!),
    onSuccess: (res) => {
      const d = res.data
      if (d.sent > 0) {
        showToast(`Reminder sent to ${d.sent} player${d.sent === 1 ? '' : 's'}`)
      } else if (d.failed > 0) {
        showToast('Could not send reminders - check that email (Resend) is configured')
      } else {
        showToast('Everyone eligible already got a reminder')
      }
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not send reminders')),
  })

  const collectFeeMut = useMutation({
    mutationFn: (teamId: string) => tournamentApi.markFeeCollected(tid!, teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-teams'] })
      qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
      showToast('Marked as paid')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not mark as paid')),
  })

  const withdrawMut = useMutation({
    mutationFn: (teamId: string) => tournamentApi.withdrawTeam(tid!, teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-teams'] })
      qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
      qc.invalidateQueries({ queryKey: ['tournament', slug] })
      showToast(isSingles ? 'Player withdrawn' : 'Team withdrawn')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not withdraw')),
  })

  const copyInviteCode = async () => {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 1600)
    } catch {
      window.prompt('Copy this code', inviteCode)
    }
  }

  const fixturesExist = matches.length > 0
  const paidCount = active?.paid_registrations ?? 0
  const maxTeams = active?.tournament.max_teams ?? 0
  const orgTeams: TournamentTeam[] = teams

  useEffect(() => {
    if (!active) return
    setOrgPanel(defaultOrgPanel(active.tournament.status, fixturesExist))
  }, [active?.tournament.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const paymentBucket = (team: TournamentTeam): 'paid' | 'owing' | 'other' => {
    if (team.payment_status === 'PENDING' || team.payment_status === 'FAILED') return 'owing'
    if (team.payment_status === 'PAID' && team.payment_via === 'pay_on_arrival') return 'owing'
    if (team.payment_status === 'PAID') return 'paid'
    return 'other'
  }

  const paymentCounts = useMemo(() => {
    let paid = 0
    let owing = 0
    let collect = 0
    let incomplete = 0
    for (const t of orgTeams) {
      if (t.payment_status === 'PENDING' || t.payment_status === 'FAILED') {
        owing += 1
        incomplete += 1
      } else if (t.payment_status === 'PAID' && t.payment_via === 'pay_on_arrival') {
        owing += 1
        collect += 1
      } else if (t.payment_status === 'PAID') {
        paid += 1
      }
    }
    return { paid, owing, collect, incomplete, total: orgTeams.length }
  }, [orgTeams])

  const unpaidCount = paymentCounts.incomplete

  const filteredTeams = useMemo(() => {
    const needle = entriesQuery.trim().toLowerCase()
    const list = orgTeams.filter((t) => {
      if (paymentFilter !== 'all' && paymentBucket(t) !== paymentFilter) return false
      if (entriesCheckInFilter === 'in' && !t.checked_in) return false
      if (entriesCheckInFilter === 'out' && t.checked_in) return false
      if (!needle) return true
      const hay = [t.name, ...(t.player_names || []), t.university_short || '', t.payment_status || '']
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })

    list.sort((a, b) => {
      if (entriesSort === 'name') {
        const byName = a.name.localeCompare(b.name)
        if (byName !== 0) return byName
      } else {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : 0
        const bTs = b.created_at ? new Date(b.created_at).getTime() : 0
        const byTime = entriesSort === 'oldest' ? aTs - bTs : bTs - aTs
        if (byTime !== 0) return byTime
        const byName = a.name.localeCompare(b.name)
        if (byName !== 0) return byName
      }
      const rank = (t: TournamentTeam) => {
        if (t.payment_status === 'PENDING' || t.payment_status === 'FAILED') return 0
        if (t.payment_status === 'PAID' && t.payment_via === 'pay_on_arrival') return 1
        if (t.payment_status === 'PAID') return 2
        return 3
      }
      return rank(a) - rank(b)
    })
    return list
  }, [orgTeams, paymentFilter, entriesCheckInFilter, entriesQuery, entriesSort])

  const checkInPool = useMemo(
    () => orgTeams.filter((t) => t.payment_status === 'PAID'),
    [orgTeams],
  )
  /** Paid entries that will actually enter the draw (complete doubles only). */
  const drawPaidTeams = useMemo(
    () =>
      orgTeams.filter((t) => {
        if (t.payment_status !== 'PAID' || t.withdrawn) return false
        if (!isSingles && (t.player_names?.length || 0) < 2) return false
        return true
      }),
    [orgTeams, isSingles],
  )
  const checkedInCount = checkInPool.filter((t) => t.checked_in).length
  const awaitingCheckInCount = checkInPool.length - checkedInCount
  const checkInRows = useMemo(() => {
    const q = checkInQuery.trim().toLowerCase()
    return [...checkInPool]
      .sort((a, b) => {
        if (a.checked_in !== b.checked_in) return a.checked_in ? 1 : -1
        return a.name.localeCompare(b.name)
      })
      .filter((t) => {
        if (checkInFilter === 'in' && !t.checked_in) return false
        if (checkInFilter === 'out' && t.checked_in) return false
        if (!q) return true
        const hay = `${t.name} ${(t.player_names || []).join(' ')}`.toLowerCase()
        return hay.includes(q)
      })
  }, [checkInPool, checkInFilter, checkInQuery])

  /** Desk pulse: progress + anything that needs a fix. */
  const dayOps = useMemo(() => {
    const done = matches.filter(
      (m) => m.status === 'COMPLETED' || m.status === 'WALKOVER',
    ).length
    const pendingConfirm = matches.filter((m) => m.status === 'AWAITING_CONFIRM')
    const needsCourt = matches.filter(
      (m) =>
        (m.status === 'LIVE' || m.status === 'CALLED' || m.status === 'AWAITING_CONFIRM') &&
        m.court_number == null &&
        m.team_a_id &&
        m.team_b_id,
    )
    // Only group fixtures missing teams need admin action — KO/Plate slots
    // fill automatically when the previous round is scored.
    const waitingTeams = matches.filter(
      (m) =>
        m.stage === 'GROUP' &&
        (m.status === 'SCHEDULED' || m.status === 'CALLED' || m.status === 'LIVE') &&
        (!m.team_a_id || !m.team_b_id),
    )
    const playable = (m: Match) => !!(m.team_a_id && m.team_b_id)
    const open = matches.filter(
      (m) =>
        playable(m) &&
        (m.status === 'SCHEDULED' ||
          m.status === 'CALLED' ||
          m.status === 'LIVE' ||
          m.status === 'AWAITING_CONFIRM'),
    ).length
    const collectFees = orgTeams.filter(
      (t) => t.payment_status === 'PAID' && t.payment_via === 'pay_on_arrival' && !t.withdrawn,
    )
    const attention: Array<{
      id: string
      label: string
      detail: string
      kind: 'fix' | 'move' | 'checkin' | 'entries'
      match?: Match
    }> = []

    for (const m of pendingConfirm) {
      attention.push({
        id: `confirm-${m.id}`,
        label: 'Confirm score',
        detail: `${m.team_a_name || 'TBD'} vs ${m.team_b_name || 'TBD'}`,
        kind: 'fix',
        match: m,
      })
    }
    for (const m of needsCourt) {
      attention.push({
        id: `court-${m.id}`,
        label: 'Needs court',
        detail: `${m.team_a_name || 'TBD'} vs ${m.team_b_name || 'TBD'}`,
        kind: 'move',
        match: m,
      })
    }
    for (const m of waitingTeams.slice(0, 4)) {
      attention.push({
        id: `teams-${m.id}`,
        label: 'Waiting on teams',
        detail: `${knockoutRoundLabel(m.round, m.stage)} · ${courtLabel(m.court_name, m.court_number)}`,
        kind: 'move',
        match: m,
      })
    }
    if (awaitingCheckInCount > 0 && (active?.tournament.status === 'LIVE' || fixturesExist)) {
      attention.push({
        id: 'checkin',
        label: 'Check-in',
        detail: `${awaitingCheckInCount} still out`,
        kind: 'checkin',
      })
    }
    if (collectFees.length > 0) {
      attention.push({
        id: 'fees',
        label: 'Collect fees',
        detail: `${collectFees.length} at venue`,
        kind: 'entries',
      })
    }

    return {
      done,
      open,
      total: matches.length,
      attention: attention.slice(0, 6),
      allClear: attention.length === 0 && matches.length > 0,
    }
  }, [
    matches,
    orgTeams,
    awaitingCheckInCount,
    active?.tournament.status,
    fixturesExist,
  ])

  /** One card per court: LIVE beats CALLED beats next SCHEDULED. */
  const courtsideNow = useMemo(() => {
    type Slot = { courtKey: string; label: string; match: Match; kind: 'live' | 'called' | 'next' }
    const byCourt = new Map<number, Match[]>()
    const unassigned: Match[] = []
    for (const m of matches) {
      if (!m.team_a_id || !m.team_b_id) continue
      if (
        m.status !== 'LIVE' &&
        m.status !== 'CALLED' &&
        m.status !== 'SCHEDULED' &&
        m.status !== 'AWAITING_CONFIRM'
      ) {
        continue
      }
      if (m.court_number == null) {
        if (m.status === 'LIVE' || m.status === 'CALLED') unassigned.push(m)
        continue
      }
      const list = byCourt.get(m.court_number) || []
      list.push(m)
      byCourt.set(m.court_number, list)
    }
    const pick = (list: Match[]): Match | null =>
      list.find((m) => m.status === 'LIVE') ||
      list.find((m) => m.status === 'CALLED') ||
      list.find((m) => m.status === 'AWAITING_CONFIRM') ||
      list
        .filter((m) => m.status === 'SCHEDULED')
        .sort((a, b) => {
          const ta = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
          const tb = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
          if (ta !== tb) return ta - tb
          return (a.sort_order || 0) - (b.sort_order || 0)
        })[0] ||
      null

    const slots: Slot[] = []
    const courtNums = Array.from(byCourt.keys()).sort((a, b) => a - b)
    for (const num of courtNums) {
      const m = pick(byCourt.get(num) || [])
      if (!m) continue
      const kind =
        m.status === 'LIVE' ? 'live' : m.status === 'CALLED' || m.status === 'AWAITING_CONFIRM' ? 'called' : 'next'
      slots.push({
        courtKey: `c-${num}`,
        label: courtLabel(m.court_name, m.court_number),
        match: m,
        kind,
      })
    }
    for (const m of unassigned) {
      slots.push({
        courtKey: `u-${m.id}`,
        label: 'Needs court',
        match: m,
        kind: m.status === 'LIVE' ? 'live' : 'called',
      })
    }
    return slots
  }, [matches])

  const paymentLabel = (team: TournamentTeam) => {
    if (team.payment_via === 'pay_on_arrival') return 'Not paid · venue'
    if (team.payment_via === 'collected_on_arrival') return 'Paid · in person'
    if (team.payment_via === 'free_entry') return 'Free'
    if (team.payment_via === 'online' || team.payment_via === 'demo_payment') return 'Paid · online'
    if (team.payment_status === 'PENDING') return 'Not paid · checkout'
    if (team.payment_status === 'PAID') return 'Paid'
    if (team.payment_status === 'FAILED') return 'Payment failed'
    if (team.payment_status === 'CANCELLED') return 'Cancelled'
    return team.payment_status || '-'
  }

  const paymentBadgeClass = (team: TournamentTeam) => {
    const bucket = paymentBucket(team)
    if (bucket === 'owing') return 'badge badge-warn'
    if (bucket === 'paid') return 'badge badge-open'
    return 'badge badge-draft'
  }
  const drawPreview = useMemo(() => {
    if (!active) return null
    return previewDraw({
      // Use entries that will actually enter the draw (complete paid only).
      teamCount: drawPaidTeams.length,
      groupSize: tournamentDetail?.group_size ?? 4,
      teamsAdvancePerGroup: tournamentDetail?.teams_advance_per_group ?? 2,
      format: activeFormat,
      enablePlate: !!tournamentDetail?.enable_plate,
      championshipSize: tournamentDetail?.championship_size ?? 16,
      plateSize: tournamentDetail?.plate_size ?? 16,
    })
  }, [
    active,
    drawPaidTeams.length,
    tournamentDetail?.group_size,
    tournamentDetail?.teams_advance_per_group,
    tournamentDetail?.enable_plate,
    tournamentDetail?.championship_size,
    tournamentDetail?.plate_size,
    activeFormat,
  ])
  const incompleteDoubles = !isSingles
    ? orgTeams.filter(
        (team) =>
          team.payment_status === 'PAID' &&
          !team.withdrawn &&
          (team.player_names?.length || 0) < 2,
      ).length
    : 0
  const canOpenGenerate = paidCount >= 2
  const generateBlockedReason = (() => {
    if (paidCount < 2) {
      return `Need at least 2 paid ${isSingles ? 'players' : 'teams'} to generate (you have ${paidCount}).`
    }
    if (incompleteDoubles > 0) {
      return `${incompleteDoubles} paid team${incompleteDoubles === 1 ? ' is' : 's are'} missing a partner. Ask them to add one, or withdraw those entries.`
    }
    if (drawPreview && !drawPreview.ok) {
      return drawPreview.error || 'Draw settings look invalid - check group / plate sizes in Edit.'
    }
    return null
  })()
  const canAddTeams =
    !!active &&
    active.tournament.status !== 'COMPLETED' &&
    active.tournament.status !== 'CANCELLED' &&
    active.tournament.status !== 'LIVE' &&
    !fixturesExist
  const daysToEvent = active ? calendarDaysFromToday(active.tournament.event_date) : null
  const showRemindersSection =
    !!active &&
    active.tournament.status !== 'CANCELLED' &&
    active.tournament.status !== 'COMPLETED' &&
    active.tournament.status !== 'DRAFT' &&
    active.tournament.status !== 'LIVE' &&
    daysToEvent != null &&
    daysToEvent >= 0
  const canSendRemindersNow = showRemindersSection && daysToEvent != null && daysToEvent <= 1

  const courtColumns = useMemo(() => {
    const fromConfig = (tournamentDetail?.courts || [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((c) => ({ number: c.number, name: c.name }))
    if (fromConfig.length) return fromConfig
    const set = new Set<number>()
    for (const m of matches) {
      if (m.court_number != null) set.add(m.court_number)
    }
    return Array.from(set)
      .sort((a, b) => a - b)
      .map((n) => ({ number: n, name: `Court ${n}` }))
  }, [tournamentDetail?.courts, matches])

  const courtNumbers = useMemo(() => courtColumns.map((c) => c.number), [courtColumns])

  const filteredMatches = useMemo(() => {
    const now = Date.now()
    const windowMs = 45 * 60 * 1000
    const stageRank = (stage: string) =>
      stage === 'KNOCKOUT' ? 0 : stage === 'PLATE' ? 1 : stage === 'GROUP' ? 2 : 3
    const sorted = [...matches].sort((a, b) => {
      const sr = stageRank(a.stage) - stageRank(b.stage)
      if (sr !== 0) return sr
      const ta = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
      const tb = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
      if (ta !== tb) return ta - tb
      return (a.sort_order || 0) - (b.sort_order || 0)
    })
    const bothTeams = (m: Match) => !!(m.team_a_id && m.team_b_id)
    return sorted.filter((m) => {
      if (courtFilter !== 'all' && String(m.court_number) !== courtFilter) return false
      if (matchFilter === 'now') {
        if (!bothTeams(m)) return false
        return (
          m.status === 'LIVE' ||
          m.status === 'CALLED' ||
          m.status === 'AWAITING_CONFIRM' ||
          (m.status === 'SCHEDULED' &&
            !!m.scheduled_start &&
            Math.abs(new Date(m.scheduled_start).getTime() - now) <= windowMs)
        )
      }
      if (matchFilter === 'upcoming') {
        return m.status === 'SCHEDULED' && bothTeams(m)
      }
      if (matchFilter === 'active') {
        // Playable open matches only — hide empty SF/Final slots until seeded
        return (
          bothTeams(m) &&
          (m.status === 'SCHEDULED' ||
            m.status === 'CALLED' ||
            m.status === 'LIVE' ||
            m.status === 'AWAITING_CONFIRM')
        )
      }
      if (matchFilter === 'done') {
        return m.status === 'COMPLETED' || m.status === 'WALKOVER' || m.status === 'CANCELLED'
      }
      return true
    })
  }, [matches, courtFilter, matchFilter])

  const hasKnockoutMatches = matches.some((m) => m.stage === 'KNOCKOUT' || m.stage === 'PLATE')
  const championshipMatches = matches.filter((m) => m.stage === 'KNOCKOUT')
  const plateMatches = matches.filter((m) => m.stage === 'PLATE')

  useEffect(() => {
    if (matchView === 'bracket' && !hasKnockoutMatches) {
      setMatchView('list')
    }
  }, [matchView, hasKnockoutMatches])

  // Once knockout is live, prefer the Draw view for scoring (once per tournament)
  useEffect(() => {
    if (!hasKnockoutMatches || bracketPreferred.current) return
    if (!isKnockoutActive(matches)) return
    bracketPreferred.current = true
    setMatchView('bracket')
    setMatchFilter('all')
  }, [hasKnockoutMatches, matches])

  const openScore = (m: Match) => {
    if (!m.team_a_id || !m.team_b_id) return
    setScoreError('')
    setScoreMatch(m)
    const defaultStatus =
      m.status === 'COMPLETED' || m.status === 'WALKOVER'
        ? m.status
        : 'COMPLETED'
    setScoreForm({
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
    })
  }

  const openMove = (m: Match) => {
    setMoveMatch(m)
    const t = m.scheduled_start ? new Date(m.scheduled_start) : null
    const hhmm = t
      ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      : ''
    setMoveForm({
      court_number: m.court_number ?? courtNumbers[0] ?? 1,
      scheduled_time: hhmm,
    })
  }

  /** Open score sheet for any match that has both teams. */
  const scoreMatchQuick = (m: Match) => {
    openScore(m)
  }

  const renderMatchActions = (m: Match, compact = false) => {
    const canScore = !!(m.team_a_id && m.team_b_id)
    if (!canScore) {
      return (
        <div className="org-match-actions">
          <span className="badge badge-draft">After previous round</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Change court or time"
            onClick={() => openMove(m)}
          >
            Move
          </button>
        </div>
      )
    }
    const locked = !!m.ratings_applied
    const done = m.status === 'COMPLETED' || m.status === 'WALKOVER' || m.status === 'CANCELLED'
    const pending = m.status === 'AWAITING_CONFIRM'
    const canNotify = !done && !!(m.team_a_id && m.team_b_id)
    return (
      <div className="org-match-actions">
        {!compact && (
          <span className={`badge ${statusBadgeClass(m.status)}`}>
            {m.status === 'AWAITING_CONFIRM'
              ? 'Confirm'
              : m.status === 'CALLED'
                ? 'Queued'
                : m.status.replace(/_/g, ' ')}
          </span>
        )}
        {canNotify && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={moveMut.isPending}
            title="Email players that their match is ready — does not change the match"
            onClick={() =>
              moveMut.mutate({ matchId: m.id, data: { notify_only: true } })
            }
          >
            Notify
          </button>
        )}
        {!done && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={moveMut.isPending}
            onClick={() => scoreMatchQuick(m)}
            title={pending ? 'Confirm or correct' : 'Log who won'}
          >
            {pending ? 'Fix' : 'Score'}
          </button>
        )}
        {done && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title={locked ? 'Correct result' : 'Edit score'}
            onClick={() => openScore(m)}
          >
            {locked ? 'Fix' : 'Edit'}
          </button>
        )}
        <button
          type="button"
          className={`btn btn-ghost btn-sm${compact ? ' org-action-more' : ''}`}
          title="Change court or time"
          onClick={() => openMove(m)}
        >
          {compact ? '···' : 'Move'}
        </button>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page">
          <div className="skeleton" style={{ height: 28, width: '40%' }} />
        </main>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="app-shell">
        <NavBar />
        <main className="page empty-state">
          <h1 className="page-title">Admin access required</h1>
          <p className="page-sub">Log in with the platform admin account to manage events.</p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link to="/login?next=%2Fmanage" className="btn btn-primary">
              Log in
            </Link>
            <Link to="/tournaments" className="btn btn-ghost">
              Browse tournaments
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="org-layout">
      <NavBar />
      {toast && <div className="org-toast">{toast}</div>}
      <div className="org-shell">
        <aside className="org-nav">
          <p className="org-nav-label">{user?.role === 'ADMIN' ? 'All events' : 'My events'}</p>
          {tournaments.map((t) => (
            <button
              key={t.tournament.id}
              className={`org-nav-item ${active?.tournament.id === t.tournament.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedId(t.tournament.id)
                setSearchParams({ t: t.tournament.id }, { replace: true })
              }}
            >
              <span className="org-nav-item-name">{t.tournament.name}</span>
              <span className="org-nav-item-meta">
                {statusLabel(t.tournament.status)}
                {user?.role === 'ADMIN'
                  ? t.tournament.is_official
                    ? ' · Official'
                    : ' · Private'
                  : ''}
              </span>
            </button>
          ))}
          <button
            className="btn btn-ghost btn-block"
            type="button"
            onClick={() => navigate('/admin')}
          >
            + New tournament
          </button>
          <div className="org-aside-note">
            <strong>Admin</strong>
            <p>Open registration, generate the draw, go live, and score from here.</p>
          </div>
        </aside>

        <main className="org-main">
          {isLoading && (
            <div aria-busy="true">
              <div className="skeleton" style={{ height: 28, width: '55%', marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 120, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 180 }} />
              <span className="visually-hidden">Loading</span>
            </div>
          )}
          {isError && !isLoading && (
            <div className="org-empty">
              <h1>Couldn’t load your events</h1>
              <p>Check your connection and try again.</p>
              <button className="btn btn-primary" onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
          {!active && !isLoading && !isError && (
            <div className="org-empty">
              <h1>No tournaments yet</h1>
              <p>Create an event from the admin portal, then manage the draw and scoring here.</p>
              <button className="btn btn-primary" type="button" onClick={() => navigate('/admin')}>
                Go to admin
              </button>
            </div>
          )}

          {active && (
            <>
              <header className="org-header">
                <div>
                  <h1>{active.tournament.name}</h1>
                  <p className="org-header-meta">
                    {statusLabel(active.tournament.status)}
                    {active.tournament.slug ? (
                      <>
                        {' · '}
                        <Link to={`/t/${active.tournament.slug}/live`}>Live</Link>
                        {' · '}
                        <Link to={`/tournament/${active.tournament.slug}/display`}>TV</Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="org-header-actions">
                  {tournamentDetail && (
                    <button type="button" className="btn btn-ghost" onClick={() => setShowEdit(true)}>
                      Edit
                    </button>
                  )}
                  {active.tournament.status === 'DRAFT' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => openMut.mutate()}
                      disabled={openMut.isPending}
                      title="Open registration"
                    >
                      Open
                    </button>
                  )}
                  {active.tournament.status === 'REGISTRATION_OPEN' && !fixturesExist && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => closeRegMut.mutate()}
                        disabled={closeRegMut.isPending}
                        title="Close registration"
                      >
                        Close
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => setConfirmGenerate(true)}
                        disabled={generateMut.isPending || !canOpenGenerate}
                        title={generateBlockedReason || 'Generate draw'}
                      >
                        Draw
                      </button>
                    </>
                  )}
                  {active.tournament.status === 'REGISTRATION_OPEN' && fixturesExist && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setConfirmGenerate(true)}
                        disabled={generateMut.isPending || !canOpenGenerate}
                        title={generateBlockedReason || 'Re-generate draw'}
                      >
                        Redraw
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => goLiveMut.mutate()}
                        disabled={goLiveMut.isPending}
                      >
                        LIVE
                      </button>
                    </>
                  )}
                  {active.tournament.status === 'REGISTRATION_CLOSED' && !fixturesExist && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => openMut.mutate()}
                        disabled={openMut.isPending}
                        title="Reopen registration"
                      >
                        Reopen
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => setConfirmGenerate(true)}
                        disabled={generateMut.isPending || !canOpenGenerate}
                        title={generateBlockedReason || 'Generate draw'}
                      >
                        Draw
                      </button>
                    </>
                  )}
                  {active.tournament.status === 'REGISTRATION_CLOSED' && fixturesExist && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => openMut.mutate()}
                        disabled={openMut.isPending}
                        title="Reopen registration"
                      >
                        Reopen
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setConfirmGenerate(true)}
                        disabled={generateMut.isPending || !canOpenGenerate}
                        title={generateBlockedReason || 'Re-generate draw'}
                      >
                        Redraw
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => goLiveMut.mutate()}
                        disabled={goLiveMut.isPending}
                      >
                        LIVE
                      </button>
                    </>
                  )}
                  {active.tournament.status === 'LIVE' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        void confirmDialog({
                          title: 'Mark completed?',
                          message: 'This ends the event for players.',
                          confirmLabel: 'Done',
                        }).then((ok) => {
                          if (ok) completeMut.mutate()
                        })
                      }}
                      disabled={completeMut.isPending}
                      title="Mark tournament completed"
                    >
                      Done
                    </button>
                  )}
                  {active.tournament.status === 'CANCELLED' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={restoreMut.isPending}
                      onClick={() => {
                        void confirmDialog({
                          title: 'Restore as draft?',
                          message: 'Open registration again when you’re ready.',
                          confirmLabel: 'Restore',
                        }).then((ok) => {
                          if (ok) restoreMut.mutate()
                        })
                      }}
                    >
                      {restoreMut.isPending ? '…' : 'Restore'}
                    </button>
                  )}
                </div>
                {(active.tournament.status !== 'CANCELLED' &&
                  active.tournament.status !== 'COMPLETED') ||
                isOwner ? (
                  <div className="org-header-danger">
                    {active.tournament.status !== 'CANCELLED' &&
                      active.tournament.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={cancelMut.isPending}
                          onClick={() => {
                            void confirmDialog({
                              title: 'Cancel event?',
                              message:
                                'Players will no longer be able to register or play. You can restore it later as a draft.',
                              confirmLabel: 'Cancel event',
                              danger: true,
                            }).then((ok) => {
                              if (ok) cancelMut.mutate()
                            })
                          }}
                        >
                          Cancel event
                        </button>
                      )}
                    {isOwner && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          void confirmDialog({
                            title: 'Delete forever?',
                            message: `Permanently delete “${active.tournament.name}”? This removes teams, matches, and scores.`,
                            confirmLabel: 'Delete',
                            danger: true,
                          }).then((ok) => {
                            if (ok) deleteMut.mutate()
                          })
                        }}
                      >
                        {deleteMut.isPending ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </div>
                ) : null}
              </header>

              {generateBlockedReason &&
                (active.tournament.status === 'REGISTRATION_OPEN' ||
                  active.tournament.status === 'REGISTRATION_CLOSED') && (
                  <p className="org-generate-hint" role="status">
                    Can’t generate yet: {generateBlockedReason}
                  </p>
                )}

              <div className="org-stats">
                <div>
                  <strong>{active.players}</strong>
                  <span>Players</span>
                </div>
                {!isSingles && (
                  <div>
                    <strong>{active.teams}</strong>
                    <span>Teams</span>
                  </div>
                )}
                <div>
                  <strong>{formatMoney(active.revenue_cents)}</strong>
                  <span>Collected</span>
                </div>
                <div>
                  <strong>
                    {active.paid_registrations}/{active.tournament.max_teams}
                  </strong>
                  <span>Registered</span>
                </div>
                <div>
                  <strong>{active.live_matches}</strong>
                  <span>Live matches</span>
                </div>
                <div>
                  <strong>
                    {active.checked_in}/{active.teams}
                  </strong>
                  <span>Checked in</span>
                </div>
              </div>

              <div className="section-tabs" role="tablist" aria-label="Event sections">
                {(
                  [
                    { id: 'registration' as const, label: 'Entries' },
                    { id: 'day-of' as const, label: 'Today' },
                    { id: 'settings' as const, label: 'More' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={orgPanel === tab.id}
                    className={`section-tab${orgPanel === tab.id ? ' is-active' : ''}`}
                    onClick={() => setOrgPanel(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {orgPanel === 'registration' && (
              <>
              <section className="org-section">
                <h2>Invite</h2>
                {inviteCode && active.tournament.status === 'REGISTRATION_OPEN' ? (
                  <div className="org-invite">
                    <div className="org-invite-code">
                      <span className="org-invite-label">Code</span>
                      <code className="share-code">{inviteCode}</code>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyInviteCode()}>
                        {codeCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    {joinUrl && <ShareQr url={joinUrl} openLabel="Join link" />}
                  </div>
                ) : inviteCode && active.tournament.status === 'DRAFT' ? (
                  <p className="muted">Open registration to share the code.</p>
                ) : inviteCode && fixturesExist ? (
                  <p className="muted">
                    <Link to={`/t/${active.tournament.slug}/live`}>Player live board</Link>
                  </p>
                ) : inviteCode ? (
                  <p className="muted">Code ready if you reopen.</p>
                ) : (
                  <p className="muted">Code appears after save.</p>
                )}
              </section>

              {showRemindersSection && (
                <section className="org-section org-reminders">
                  <div className="org-section-head">
                    <h2>Reminders</h2>
                    {canSendRemindersNow ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={remindMut.isPending || !tid}
                        onClick={() => {
                          void confirmDialog({
                            title: 'Send reminder emails?',
                            message: 'Email paid players who haven’t had a reminder yet.',
                            confirmLabel: 'Send',
                          }).then((ok) => {
                            if (ok) remindMut.mutate()
                          })
                        }}
                      >
                        {remindMut.isPending ? 'Sending…' : 'Send now'}
                      </button>
                    ) : null}
                  </div>
                  <p className="muted org-reminders-copy">
                    {canSendRemindersNow
                      ? 'Automatic emails go out the day before with time, venue, and a Log in button. Use Send now if anyone still needs one.'
                      : 'Paid players get an automatic email the day before with time, venue, and a Log in button. Late joiners are included.'}
                  </p>
                </section>
              )}

              <section className="org-section">
                <div className="org-section-head">
                  <h2>Entries & payments</h2>
                  {canAddTeams && (
                    <button type="button" className="btn btn-dark btn-sm" onClick={() => setShowAddTeam(true)}>
                      {isSingles ? 'Add player' : 'Add team'}
                    </button>
                  )}
                </div>
                {orgTeams.length > 0 && (
                  <div className="org-pay-toolbar">
                    <input
                      type="search"
                      className="org-entries-search"
                      placeholder={isSingles ? 'Search player…' : 'Search team or player…'}
                      value={entriesQuery}
                      onChange={(e) => setEntriesQuery(e.target.value)}
                      aria-label="Search entries"
                    />
                    <div className="org-view-toggle org-pay-filters" role="group" aria-label="Payment filter">
                      <button
                        type="button"
                        className={`btn btn-sm ${paymentFilter === 'all' ? 'btn-dark' : 'btn-ghost'}`}
                        onClick={() => setPaymentFilter('all')}
                      >
                        All ({paymentCounts.total})
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${paymentFilter === 'paid' ? 'btn-dark' : 'btn-ghost'}`}
                        onClick={() => setPaymentFilter('paid')}
                      >
                        Paid ({paymentCounts.paid})
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${paymentFilter === 'owing' ? 'btn-dark' : 'btn-ghost'}`}
                        onClick={() => setPaymentFilter('owing')}
                      >
                        Not paid ({paymentCounts.owing})
                      </button>
                    </div>
                    <div className="org-view-toggle org-pay-filters" role="group" aria-label="Check-in filter">
                      <button
                        type="button"
                        className={`btn btn-sm ${entriesCheckInFilter === 'all' ? 'btn-dark' : 'btn-ghost'}`}
                        onClick={() => setEntriesCheckInFilter('all')}
                      >
                        Any check-in
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${entriesCheckInFilter === 'in' ? 'btn-dark' : 'btn-ghost'}`}
                        onClick={() => setEntriesCheckInFilter('in')}
                      >
                        Checked in ({orgTeams.filter((t) => t.checked_in).length})
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${entriesCheckInFilter === 'out' ? 'btn-dark' : 'btn-ghost'}`}
                        onClick={() => setEntriesCheckInFilter('out')}
                      >
                        Not checked in ({orgTeams.filter((t) => !t.checked_in).length})
                      </button>
                    </div>
                    <div className="org-entries-meta-row">
                      <label className="org-entries-sort">
                        Sort
                        <select
                          value={entriesSort}
                          onChange={(e) =>
                            setEntriesSort(e.target.value as 'newest' | 'oldest' | 'name')
                          }
                        >
                          <option value="newest">Newest signup</option>
                          <option value="oldest">Oldest signup</option>
                          <option value="name">Name</option>
                        </select>
                      </label>
                    </div>
                    {paymentCounts.owing > 0 ? (
                      <p className="org-pay-hint">
                        {paymentCounts.collect > 0 && (
                          <>
                            <strong>{paymentCounts.collect}</strong> in the draw - tap{' '}
                            <strong>Mark paid</strong> when you collect cash/card
                            {paymentCounts.incomplete > 0 ? ' · ' : ''}
                          </>
                        )}
                        {paymentCounts.incomplete > 0 && (
                          <>
                            <strong>{paymentCounts.incomplete}</strong> still finishing online checkout
                            (not in the draw yet)
                          </>
                        )}
                      </p>
                    ) : (
                      <p className="org-pay-hint">Everyone here is paid up.</p>
                    )}
                  </div>
                )}

                <div className="org-table">
                  {filteredTeams.map((team) => {
                    const owing = paymentBucket(team) === 'owing'
                    const canCollect = team.payment_via === 'pay_on_arrival'
                    const signedUp = formatDateTime(team.created_at)
                    const unpaidEntry =
                      team.payment_status === 'PENDING' ||
                      team.payment_status === 'CANCELLED' ||
                      team.payment_status === 'FAILED' ||
                      team.payment_status === 'REFUNDED'
                    return (
                      <div key={team.id} className={`org-row org-pay-row${owing ? ' is-owing' : ''}`}>
                        <div>
                          <div className="org-entry-title-row">
                            <strong>{team.name}</strong>
                            {signedUp && <span className="org-entry-signed-up">{signedUp}</span>}
                          </div>
                          <span>{team.player_names?.join(' / ')}</span>
                          <span className={paymentBadgeClass(team)}>{paymentLabel(team)}</span>
                          {!!team.custom_answers?.length && (
                            <ul className="org-custom-answers">
                              {team.custom_answers.map((a, i) => {
                                const who =
                                  a.scope === 'player' && a.player_name
                                    ? a.player_name
                                    : a.scope === 'player' && a.slot === 2
                                      ? 'Partner'
                                      : null
                                const display =
                                  a.value === 'yes' ? 'Yes' : a.value === 'no' ? 'No' : a.value
                                return (
                                  <li key={`${a.field_id}-${a.slot ?? 't'}-${i}`}>
                                    <span className="org-custom-label">
                                      {who ? `${who} · ${a.label}` : a.label}
                                    </span>
                                    <span className="org-custom-value">{display}</span>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                        <div className="org-row-right org-pay-actions">
                          {canCollect && (
                            <button
                              type="button"
                              className="btn btn-dark btn-sm"
                              disabled={collectFeeMut.isPending}
                              onClick={() => {
                                void confirmDialog({
                                  title: 'Mark as paid?',
                                  message: `Mark ${team.name} as paid after collecting ${formatMoney(active.tournament.entry_fee_cents, active.tournament.currency)} in person.`,
                                  confirmLabel: 'Mark paid',
                                }).then((ok) => {
                                  if (ok) collectFeeMut.mutate(team.id)
                                })
                              }}
                            >
                              Mark paid
                            </button>
                          )}
                          {team.checked_in ? <span className="checked">✓ Checked in</span> : null}
                          {unpaidEntry && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={withdrawMut.isPending}
                              onClick={() => {
                                void confirmDialog({
                                  title: 'Remove entry?',
                                  message: `Remove unpaid entry ${team.name}?`,
                                  confirmLabel: 'Remove',
                                  danger: true,
                                }).then((ok) => {
                                  if (ok) withdrawMut.mutate(team.id)
                                })
                              }}
                            >
                              Remove
                            </button>
                          )}
                          {team.payment_status === 'PAID' &&
                            active.tournament.status !== 'LIVE' &&
                            active.tournament.status !== 'COMPLETED' && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={withdrawMut.isPending}
                                onClick={() => {
                                  const base = fixturesExist
                                    ? `Withdraw ${team.name}? Regenerate the draw afterwards so fixtures stay correct.`
                                    : `Withdraw ${team.name}?`
                                  const feeNote =
                                    team.payment_via === 'pay_on_arrival'
                                      ? ' They haven’t paid online - this just frees the spot.'
                                      : active.tournament.refunds_on_withdrawal === false
                                        ? ' Refunds are off for this event - players are told it’s too close for a refund.'
                                        : ' Entry fees are not refunded automatically.'
                                  void confirmDialog({
                                    title: isSingles ? 'Withdraw player?' : 'Withdraw team?',
                                    message: `${base}${feeNote}`,
                                    confirmLabel: 'Withdraw',
                                    danger: true,
                                  }).then((ok) => {
                                    if (ok) withdrawMut.mutate(team.id)
                                  })
                                }}
                              >
                                Withdraw
                              </button>
                            )}
                        </div>
                      </div>
                    )
                  })}
                  {orgTeams.length === 0 && (
                    <p className="muted">
                      {isSingles
                        ? 'No players registered yet. Share the invite or add a player.'
                        : 'No teams registered yet. Share the invite or add a team.'}
                    </p>
                  )}
                  {orgTeams.length > 0 && filteredTeams.length === 0 && (
                    <p className="muted">
                      {entriesQuery.trim() || entriesCheckInFilter !== 'all'
                        ? 'No entries match these filters.'
                        : paymentFilter === 'paid'
                          ? 'Nobody marked paid yet.'
                          : paymentFilter === 'owing'
                            ? 'Everyone here is paid.'
                            : 'No entries to show.'}
                    </p>
                  )}
                </div>
              </section>
              </>
              )}

              {orgPanel === 'day-of' && (
              <>
              {matches.length > 0 && (
                <section className="org-section org-pulse" aria-label="Day progress">
                  <div className="org-pulse-row">
                    <span>
                      <strong>{dayOps.done}</strong> done
                    </span>
                    <span>
                      <strong>{dayOps.open}</strong> to play
                    </span>
                    {dayOps.allClear ? (
                      <span className="org-pulse-ok">All clear</span>
                    ) : dayOps.attention.length > 0 ? (
                      <span className="org-pulse-warn">{dayOps.attention.length} need you</span>
                    ) : null}
                  </div>
                  {dayOps.attention.length > 0 && (
                    <ul className="org-attention">
                      {dayOps.attention.map((item) => (
                        <li key={item.id}>
                          <div>
                            <strong>{item.label}</strong>
                            <span>{item.detail}</span>
                          </div>
                          {item.kind === 'fix' && item.match ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => openScore(item.match!)}
                            >
                              Fix
                            </button>
                          ) : null}
                          {item.kind === 'move' && item.match ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => openMove(item.match!)}
                            >
                              Move
                            </button>
                          ) : null}
                          {item.kind === 'checkin' ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setCheckInFilter('out')
                                document.getElementById('org-checkin')?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start',
                                })
                              }}
                            >
                              Open
                            </button>
                          ) : null}
                          {item.kind === 'entries' ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setPaymentFilter('owing')
                                setOrgPanel('registration')
                              }}
                            >
                              Entries
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {courtsideNow.length > 0 && (
                <section className="org-section org-now-board">
                  <div className="org-section-head">
                    <h2>Courts now</h2>
                    <span className="muted">{courtsideNow.length}</span>
                  </div>
                  <div className="org-now-grid">
                    {courtsideNow.map((slot) => {
                      const m = slot.match
                      const canTapScore = !!(m.team_a_id && m.team_b_id)
                      return (
                        <div
                          key={slot.courtKey}
                          className={`org-now-card ${
                            m.status === 'AWAITING_CONFIRM'
                              ? 'is-attention'
                              : slot.kind === 'live'
                                ? 'is-live'
                                : slot.kind === 'called'
                                  ? 'is-called'
                                  : ''
                          }${canTapScore ? ' is-tap' : ''}`}
                          role={canTapScore ? 'button' : undefined}
                          tabIndex={canTapScore ? 0 : undefined}
                          onClick={
                            canTapScore
                              ? (e) => {
                                  if ((e.target as HTMLElement).closest('button')) return
                                  scoreMatchQuick(m)
                                }
                              : undefined
                          }
                          onKeyDown={
                            canTapScore
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    scoreMatchQuick(m)
                                  }
                                }
                              : undefined
                          }
                        >
                          <div className="org-now-top">
                            <strong>{slot.label}</strong>
                            <span className="org-now-kicker">
                              {m.status === 'AWAITING_CONFIRM'
                                ? 'Fix score'
                                : slot.kind === 'live'
                                  ? 'Live'
                                  : 'Next'}
                            </span>
                          </div>
                          <p className="org-now-round">{knockoutRoundLabel(m.round, m.stage)}</p>
                          <p className="org-now-vs">
                            {m.team_a_name || m.team_a_placeholder || 'TBD'} vs{' '}
                            {m.team_b_name || m.team_b_placeholder || 'TBD'}
                          </p>
                          {m.score && (m.score.set1_a || m.score.set1_b) ? (
                            <span className="org-now-meta">{formatMatchScore(m.score)}</span>
                          ) : null}
                          {m.scheduled_start && slot.kind === 'next' ? (
                            <span className="org-now-meta">{formatTime(m.scheduled_start)}</span>
                          ) : null}
                          {renderMatchActions(m, true)}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              <section className="org-section">
                <div className="org-section-head">
                  <h2>{hasKnockoutMatches && isKnockoutActive(matches) ? 'Knockout' : 'Matches'}</h2>
                </div>
                {matches.length > 0 && (
                  <div className="org-match-filters">
                    <div className="org-view-toggle" role="group" aria-label="Match view">
                      <button
                        type="button"
                        className={`btn btn-sm ${matchView === 'list' ? 'btn-dark' : 'btn-ghost'}`}
                        onClick={() => setMatchView('list')}
                      >
                        List
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${matchView === 'courts' ? 'btn-dark' : 'btn-ghost'}`}
                        onClick={() => setMatchView('courts')}
                      >
                        Courts
                      </button>
                      {hasKnockoutMatches && (
                        <button
                          type="button"
                          className={`btn btn-sm ${matchView === 'bracket' ? 'btn-dark' : 'btn-ghost'}`}
                          onClick={() => setMatchView('bracket')}
                        >
                          Draw
                        </button>
                      )}
                    </div>
                    {matchView !== 'bracket' && (
                      <select
                        className="form-select"
                        value={matchFilter}
                        onChange={(e) =>
                          setMatchFilter(
                            e.target.value as 'now' | 'upcoming' | 'active' | 'all' | 'done',
                          )
                        }
                        aria-label="Filter matches"
                      >
                        <option value="all">All</option>
                        <option value="now">Now</option>
                        <option value="upcoming">Next</option>
                        <option value="active">Open</option>
                        <option value="done">Done</option>
                      </select>
                    )}
                    {matchView === 'list' && (
                      <select
                        className="form-select"
                        value={courtFilter}
                        onChange={(e) => setCourtFilter(e.target.value)}
                        aria-label="Filter by court"
                      >
                        <option value="all">All courts</option>
                        {courtColumns.map((c) => (
                          <option key={c.number} value={String(c.number)}>
                            {c.name || `Court ${c.number}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                {matchView === 'bracket' && hasKnockoutMatches && (
                  <div className="org-bracket">
                    <p className="muted org-section-lead" style={{ marginTop: 0 }}>
                      Tap a match to score. Next round fills in automatically.
                    </p>
                    {championshipMatches.length > 0 && (
                      <div className="org-bracket-block">
                        <TournamentBracket
                          matches={championshipMatches}
                          stage="KNOCKOUT"
                          onScoreMatch={scoreMatchQuick}
                        />
                      </div>
                    )}
                    {plateMatches.length > 0 && (
                      <div className="org-bracket-block">
                        <TournamentBracket
                          matches={plateMatches}
                          stage="PLATE"
                          onScoreMatch={scoreMatchQuick}
                        />
                      </div>
                    )}
                  </div>
                )}
                {matchView === 'courts' && matches.length > 0 && (
                  <div className="org-court-board">
                    {filteredMatches.length === 0 ? (
                      <p className="muted">No matches match this filter.</p>
                    ) : (
                      <>
                        {courtColumns.map((col) => {
                          const courtMatches = filteredMatches.filter((m) => m.court_number === col.number)
                          return (
                            <div key={col.number} className="org-court-col">
                              <h3>{col.name || `Court ${col.number}`}</h3>
                              {courtMatches.length === 0 && <p className="muted">Free</p>}
                              {courtMatches.map((m) => {
                                const canTap = !!(m.team_a_id && m.team_b_id)
                                return (
                                <div
                                  key={m.id}
                                  className={`org-court-card is-${m.status.toLowerCase()}${canTap ? ' is-tap' : ''}`}
                                  role={canTap ? 'button' : undefined}
                                  tabIndex={canTap ? 0 : undefined}
                                  onClick={
                                    canTap
                                      ? (e) => {
                                          if ((e.target as HTMLElement).closest('button')) return
                                          scoreMatchQuick(m)
                                        }
                                      : undefined
                                  }
                                  onKeyDown={
                                    canTap
                                      ? (e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            scoreMatchQuick(m)
                                          }
                                        }
                                      : undefined
                                  }
                                >
                                  <strong>
                                    {m.team_a_name || m.team_a_placeholder || 'TBD'} vs{' '}
                                    {m.team_b_name || m.team_b_placeholder || 'TBD'}
                                  </strong>
                                  <span>
                                    {knockoutRoundLabel(m.round, m.stage)}
                                    {m.score ? ` · ${formatMatchScore(m.score)}` : ''}
                                    {m.scheduled_start ? ` · ${formatTime(m.scheduled_start)}` : ''}
                                  </span>
                                  {renderMatchActions(m, true)}
                                </div>
                                )
                              })}
                            </div>
                          )
                        })}
                        {filteredMatches.some((m) => m.court_number == null) && (
                          <div className="org-court-col">
                            <h3>Unassigned</h3>
                            {filteredMatches
                              .filter((m) => m.court_number == null)
                              .map((m) => (
                                <div key={m.id} className="org-court-card">
                                  <strong>
                                    {m.team_a_name || m.team_a_placeholder || 'TBD'} vs{' '}
                                    {m.team_b_name || m.team_b_placeholder || 'TBD'}
                                  </strong>
                                  {renderMatchActions(m, true)}
                                </div>
                              ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                {matchView === 'list' && (
                  <div className="org-table">
                    {filteredMatches.map((m, idx) => {
                      const canScore = !!(m.team_a_id && m.team_b_id)
                      const prev = filteredMatches[idx - 1]
                      const showPath =
                        !!matchPathLabel(m.stage) &&
                        (!prev || prev.stage !== m.stage)
                      const laterRound = !canScore && (m.stage === 'KNOCKOUT' || m.stage === 'PLATE')
                      return (
                        <div key={m.id}>
                          {showPath ? (
                            <p className={`org-path-head org-path-head--${m.stage.toLowerCase()}`}>
                              {matchPathLabel(m.stage)}
                            </p>
                          ) : null}
                          <div
                            className={`org-row ${m.status === 'CALLED' ? 'is-called' : ''} ${m.status === 'LIVE' ? 'is-live' : ''} ${m.stage === 'PLATE' ? 'is-plate' : ''} ${m.stage === 'KNOCKOUT' ? 'is-champ' : ''}${canScore ? ' is-tap' : ''}`}
                            role={canScore ? 'button' : undefined}
                            tabIndex={canScore ? 0 : undefined}
                            onClick={
                              canScore
                                ? (e) => {
                                    if ((e.target as HTMLElement).closest('button')) return
                                    scoreMatchQuick(m)
                                  }
                                : undefined
                            }
                            onKeyDown={
                              canScore
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      scoreMatchQuick(m)
                                    }
                                  }
                                : undefined
                            }
                          >
                            <div>
                              <strong>
                                {knockoutRoundLabel(m.round, m.stage)} ·{' '}
                                {courtLabel(m.court_name, m.court_number)}
                                {m.scheduled_start ? ` · ${formatTime(m.scheduled_start)}` : ''}
                              </strong>
                              <span>
                                {m.team_a_name || m.team_a_placeholder || 'TBD'} vs{' '}
                                {m.team_b_name || m.team_b_placeholder || 'TBD'}
                                {m.score ? ` · ${formatMatchScore(m.score)}` : ''}
                              </span>
                            </div>
                            <div className="org-row-right">
                              {canScore ? (
                                renderMatchActions(m)
                              ) : laterRound ? (
                                <span className="badge badge-draft">After previous round</span>
                              ) : (
                                <span className="badge badge-draft">Waiting for teams</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {matches.length === 0 && (
                      <p className="muted">Generate the draw first.</p>
                    )}
                    {matches.length > 0 && filteredMatches.length === 0 && (
                      <p className="muted">Nothing here.</p>
                    )}
                  </div>
                )}
              </section>

              {checkInPool.length > 0 && (
                <details
                  id="org-checkin"
                  className="org-section org-checkin"
                  open={awaitingCheckInCount > 0}
                >
                  <summary className="org-section-head org-checkin-summary">
                    <h2>Check-in</h2>
                    <span className="org-checkin-count">
                      {checkedInCount}/{checkInPool.length}
                    </span>
                  </summary>
                  <div className="org-entries-search" style={{ marginBottom: '0.75rem' }}>
                    <label className="visually-hidden" htmlFor="checkin-search">
                      Search teams
                    </label>
                    <input
                      id="checkin-search"
                      className="form-input"
                      type="search"
                      placeholder="Search…"
                      value={checkInQuery}
                      onChange={(e) => setCheckInQuery(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div
                    className="org-view-toggle org-pay-filters"
                    role="group"
                    aria-label="Check-in filter"
                  >
                    <button
                      type="button"
                      className={`btn btn-sm ${checkInFilter === 'out' ? 'btn-dark' : 'btn-ghost'}`}
                      onClick={() => setCheckInFilter('out')}
                    >
                      Out ({awaitingCheckInCount})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${checkInFilter === 'in' ? 'btn-dark' : 'btn-ghost'}`}
                      onClick={() => setCheckInFilter('in')}
                    >
                      In ({checkedInCount})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${checkInFilter === 'all' ? 'btn-dark' : 'btn-ghost'}`}
                      onClick={() => setCheckInFilter('all')}
                    >
                      All
                    </button>
                  </div>
                  <div className="org-table org-checkin-table">
                    {checkInRows.map((team) => {
                      const owesOnArrival = team.payment_via === 'pay_on_arrival'
                      return (
                        <div
                          key={team.id}
                          className={`org-row org-checkin-row${team.checked_in ? ' is-in' : ''}`}
                        >
                          <div>
                            <strong>{team.name}</strong>
                            <span>{team.player_names?.join(' / ')}</span>
                            {owesOnArrival ? (
                              <span className="badge badge-warn">Pay</span>
                            ) : null}
                          </div>
                          <div className="org-row-right org-pay-actions">
                            {team.checked_in ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={checkInMut.isPending}
                                title="Undo check-in"
                                onClick={() =>
                                  checkInMut.mutate({ teamId: team.id, present: false })
                                }
                              >
                                Undo
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-dark btn-sm"
                                disabled={checkInMut.isPending}
                                onClick={() => {
                                  if (owesOnArrival) {
                                    void confirmDialog({
                                      title: 'Still owes?',
                                      message: `${team.name} hasn’t paid at the venue. Check in anyway?`,
                                      confirmLabel: 'Check in',
                                    }).then((ok) => {
                                      if (ok) checkInMut.mutate({ teamId: team.id, present: true })
                                    })
                                    return
                                  }
                                  checkInMut.mutate({ teamId: team.id, present: true })
                                }}
                              >
                                In
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {checkInRows.length === 0 && (
                      <p className="muted">
                        {checkInQuery.trim()
                          ? 'No match.'
                          : checkInFilter === 'out'
                            ? 'All in.'
                            : checkInFilter === 'in'
                              ? 'Nobody yet.'
                              : 'No entries.'}
                      </p>
                    )}
                  </div>
                </details>
              )}

              <details className="org-section org-announce-block">
                <summary className="org-section-head">
                  <h2>Announce</h2>
                  {announcements.length > 0 ? (
                    <span className="muted">{announcements.length}</span>
                  ) : null}
                </summary>
                {announcements.length > 0 && (
                  <ul className="org-announce-list">
                    {announcements.slice(0, 8).map((a) => (
                      <li key={a.id} className="org-announce-item">
                        <div>
                          <strong>{a.title}</strong>
                          <span>{a.body}</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={deleteAnnounceMut.isPending}
                          onClick={() => {
                            void confirmDialog({
                              title: 'Delete?',
                              message: `Remove “${a.title}”?`,
                              confirmLabel: 'Delete',
                              danger: true,
                            }).then((ok) => {
                              if (ok) deleteAnnounceMut.mutate(a.id)
                            })
                          }}
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="form-group">
                  <input
                    className="form-input"
                    placeholder="Title"
                    value={announce.title}
                    onChange={(e) => setAnnounce({ ...announce, title: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="e.g. Court 4 delayed 10 mins"
                    value={announce.body}
                    onChange={(e) => setAnnounce({ ...announce, body: e.target.value })}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!announce.title || !announce.body || announceMut.isPending}
                  onClick={() =>
                    announceMut.mutate({ title: announce.title, body: announce.body })
                  }
                >
                  Post
                </button>
              </details>
              </>
              )}

              {orgPanel === 'settings' && (
              <>
              <section className="org-section">
                <h2>Sponsors</h2>
                <p className="muted-note" style={{ marginTop: 0 }}>
                  Logo and name show at the top of the tournament page, join flow, and TV display.
                </p>
                {sponsors.length > 0 && (
                  <>
                    <div className="org-sponsor-preview" aria-label="Player preview">
                      <p className="org-sponsor-preview-label">Player preview</p>
                      <SponsorStrip sponsors={sponsors} placement="hero" />
                    </div>
                    <ul className="org-sponsor-list">
                      {sponsors.map((s) => (
                        <li key={s.id} className="org-sponsor-item">
                          <div className="org-sponsor-thumb">
                            {s.logo_url ? (
                              <img src={mediaUrl(s.logo_url)} alt="" />
                            ) : (
                              <span aria-hidden>{s.name.slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="org-sponsor-meta">
                            <strong>
                              {s.name}
                              {s.level === 'MAIN' ? <em> · Featured</em> : null}
                            </strong>
                            {s.website ? (
                              <span className="muted">{s.website.replace(/^https?:\/\//, '')}</span>
                            ) : (
                              <span className="muted">No website</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={deleteSponsorMut.isPending}
                            onClick={() => {
                              void confirmDialog({
                                title: 'Remove sponsor?',
                                message: `Remove “${s.name}” from this event?`,
                                confirmLabel: 'Remove',
                                danger: true,
                              }).then((ok) => {
                                if (ok) deleteSponsorMut.mutate(s.id)
                              })
                            }}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="org-sponsor-form">
                  <div className="form-group">
                    <label className="form-label" htmlFor="sponsor-name">
                      Name
                    </label>
                    <input
                      id="sponsor-name"
                      className="form-input"
                      placeholder="Sponsor name"
                      value={sponsorForm.name}
                      onChange={(e) => setSponsorForm({ ...sponsorForm, name: e.target.value })}
                      maxLength={200}
                      autoCapitalize="words"
                      enterKeyHint="next"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="sponsor-website">
                      Website <span className="muted">(optional)</span>
                    </label>
                    <input
                      id="sponsor-website"
                      className="form-input"
                      type="text"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="example.com"
                      value={sponsorForm.website}
                      onChange={(e) => setSponsorForm({ ...sponsorForm, website: e.target.value })}
                      enterKeyHint="done"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="sponsor-logo">
                      Logo <span className="muted">(recommended)</span>
                    </label>
                    <div className={`org-sponsor-upload${sponsorPreview ? ' has-preview' : ''}`}>
                      {sponsorPreview ? (
                        <img src={sponsorPreview} alt="" className="org-sponsor-logo-preview" />
                      ) : (
                        <span className="org-sponsor-upload-hint">Tap to choose logo</span>
                      )}
                      <input
                        key={sponsorLogoKey}
                        id="sponsor-logo"
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp,.gif"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null
                          if (!file) {
                            setSponsorForm({ ...sponsorForm, logo: null })
                            return
                          }
                          if (file.size > 2 * 1024 * 1024) {
                            showToast('Logo must be 2MB or smaller')
                            e.target.value = ''
                            return
                          }
                          const type = (file.type || '').toLowerCase()
                          const name = file.name.toLowerCase()
                          const heic =
                            type.includes('heic') ||
                            type.includes('heif') ||
                            name.endsWith('.heic') ||
                            name.endsWith('.heif')
                          if (heic) {
                            showToast('Use JPG or PNG - iPhone HEIC photos aren’t supported yet')
                            e.target.value = ''
                            return
                          }
                          setSponsorForm({ ...sponsorForm, logo: file })
                        }}
                      />
                    </div>
                    {sponsorForm.logo ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm org-sponsor-clear-logo"
                        onClick={() => {
                          setSponsorForm({ ...sponsorForm, logo: null })
                          setSponsorLogoKey((k) => k + 1)
                        }}
                      >
                        Clear logo
                      </button>
                    ) : null}
                  </div>
                  <label className="org-sponsor-featured">
                    <input
                      type="checkbox"
                      checked={sponsorForm.featured}
                      onChange={(e) => setSponsorForm({ ...sponsorForm, featured: e.target.checked })}
                    />
                    <span>Featured (shown a bit larger)</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={sponsorForm.name.trim().length < 2 || sponsorMut.isPending || sponsors.length >= 12}
                    onClick={() =>
                      sponsorMut.mutate({
                        name: sponsorForm.name.trim(),
                        website: sponsorForm.website.trim() || undefined,
                        featured: sponsorForm.featured,
                        logo: sponsorForm.logo,
                      })
                    }
                  >
                    {sponsorMut.isPending ? 'Adding…' : 'Add sponsor'}
                  </button>
                  {sponsors.length >= 12 ? (
                    <p className="muted-note" style={{ marginTop: 8 }}>
                      Maximum 12 sponsors reached.
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="org-section">
                <h2>Tournament admins</h2>
                <ul className="org-admin-list">
                  {tournamentAdmins.map((a) => (
                    <li key={`${a.user_id}-${a.role}`}>
                      <div>
                        <strong>{a.full_name}</strong>
                        <span className="muted">
                          {a.email} · {a.is_owner ? 'Owner' : a.role === 'SCORER' ? 'Scorer' : 'Manager'}
                        </span>
                      </div>
                      {isOwner && !a.is_owner && (
                        <div className="org-admin-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={transferOwnerMut.isPending}
                            onClick={() => {
                              void confirmDialog({
                                title: 'Transfer ownership?',
                                message: `Make ${a.full_name} the owner? You stay as a co-admin.`,
                                confirmLabel: 'Transfer',
                              }).then((ok) => {
                                if (ok) transferOwnerMut.mutate(a.user_id)
                              })
                            }}
                          >
                            Make owner
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={removeAdminMut.isPending}
                            onClick={() => {
                              void confirmDialog({
                                title: 'Remove admin?',
                                message: `Remove ${a.full_name} as admin?`,
                                confirmLabel: 'Remove',
                                danger: true,
                              }).then((ok) => {
                                if (ok) removeAdminMut.mutate(a.user_id)
                              })
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {isOwner && (
                  <div className="org-admin-add">
                    <div className="form-group">
                      <label className="form-label">Add admin by name or email</label>
                      <input
                        className="form-input"
                        placeholder="Search players…"
                        value={adminQuery}
                        onChange={(e) => void searchAdmins(e.target.value)}
                      />
                    </div>
                    {adminSearching && <p className="muted">Searching…</p>}
                    {adminResults.length > 0 && (
                      <ul className="org-admin-search">
                        {adminResults.slice(0, 6).map((p) => (
                          <li key={p.id}>
                            <span>
                              {p.full_name}
                              {p.university_short ? ` · ${p.university_short}` : ''}
                            </span>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={addAdminMut.isPending}
                              onClick={() => addAdminMut.mutate(p.id)}
                            >
                              Add
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
              </>
              )}
            </>
          )}
        </main>
      </div>

      {showEdit && tournamentDetail && (
        <EditTournamentModal
          tournament={tournamentDetail}
          fixturesExist={fixturesExist}
          onClose={() => setShowEdit(false)}
          onSaved={(msg) => showToast(msg)}
        />
      )}

      {showAddTeam && tid && (
        <AddTeamModal
          tournamentId={tid}
          playFormat={isSingles ? 'SINGLES' : 'DOUBLES'}
          friends={friendOptions}
          onClose={() => setShowAddTeam(false)}
          onAdded={(msg) => {
            showToast(msg)
            qc.invalidateQueries({ queryKey: ['org-teams'] })
            qc.invalidateQueries({ queryKey: ['manage-dashboard'] })
            qc.invalidateQueries({ queryKey: ['tournament', slug] })
          }}
        />
      )}

      <GenerateDrawModal
        open={confirmGenerate}
        fixturesExist={fixturesExist}
        isSingles={isSingles}
        playFormat={activePlayFormat}
        format={activeFormat}
        enablePlate={!!tournamentDetail?.enable_plate}
        groupSize={tournamentDetail?.group_size ?? 4}
        teamsAdvancePerGroup={tournamentDetail?.teams_advance_per_group ?? 2}
        championshipSize={tournamentDetail?.championship_size ?? 16}
        plateSize={tournamentDetail?.plate_size ?? 16}
        paidTeams={drawPaidTeams}
        unpaidCount={unpaidCount}
        collectCount={paymentCounts.collect}
        maxTeams={maxTeams}
        drawPreview={drawPreview}
        generateBlockedReason={generateBlockedReason}
        isPending={generateMut.isPending}
        onClose={() => {
          if (!generateMut.isPending) setConfirmGenerate(false)
        }}
        onGenerate={(payload) => generateMut.mutate(payload)}
      />

      {scoreMatch && (
        <div
          className="modal-backdrop score-modal-backdrop org-score-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setScoreMatch(null)
              setScoreError('')
            }
          }}
        >
          <div
            className="score-modal pl-score-sheet org-score-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-entry-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="score-entry-title">
              {scoreMatch.ratings_applied ||
              scoreMatch.status === 'COMPLETED' ||
              scoreMatch.status === 'WALKOVER'
                ? 'Correct result'
                : 'Who won?'}
            </h2>
            {scoreMatch.status === 'AWAITING_CONFIRM' && (
              <p className="muted-note" style={{ marginTop: 0 }}>
                Fix and save to finalise.
              </p>
            )}
            {scoringMode === 'SIMPLE' ? (
              <>
                <p className="muted-note" style={{ marginTop: 0 }}>
                  Tap the winner. Score optional.
                </p>
                <div className="score-team-grid" role="group" aria-label="Winner and score">
                  <div
                    className={`score-team-card ${
                      scoreForm.winner_id === scoreMatch.team_a_id ? 'is-winner' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="score-team-win"
                      onClick={() =>
                        setScoreForm({
                          ...scoreForm,
                          winner_id: scoreMatch.team_a_id || '',
                          status: scoreForm.status === 'WALKOVER' ? 'WALKOVER' : 'COMPLETED',
                        })
                      }
                    >
                      <span className="score-team-win-label">
                        {scoreForm.winner_id === scoreMatch.team_a_id ? 'Winner' : 'Tap if won'}
                      </span>
                      <strong>{scoreMatch.team_a_name || 'Team A'}</strong>
                    </button>
                    <div className="score-team-points">
                      <span className="score-team-points-label">Score</span>
                      <ScoreStep
                        label={`${scoreMatch.team_a_name || 'Team A'} score`}
                        value={scoreForm.set1_a}
                        max={99}
                        onChange={(n) => {
                          const next = { ...scoreForm, set1_a: n, status: 'COMPLETED' as string }
                          if (n > scoreForm.set1_b) next.winner_id = scoreMatch.team_a_id || ''
                          else if (n < scoreForm.set1_b) next.winner_id = scoreMatch.team_b_id || ''
                          setScoreForm(next)
                        }}
                      />
                    </div>
                  </div>
                  <div
                    className={`score-team-card ${
                      scoreForm.winner_id === scoreMatch.team_b_id ? 'is-winner' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="score-team-win"
                      onClick={() =>
                        setScoreForm({
                          ...scoreForm,
                          winner_id: scoreMatch.team_b_id || '',
                          status: scoreForm.status === 'WALKOVER' ? 'WALKOVER' : 'COMPLETED',
                        })
                      }
                    >
                      <span className="score-team-win-label">
                        {scoreForm.winner_id === scoreMatch.team_b_id ? 'Winner' : 'Tap if won'}
                      </span>
                      <strong>{scoreMatch.team_b_name || 'Team B'}</strong>
                    </button>
                    <div className="score-team-points">
                      <span className="score-team-points-label">Score</span>
                      <ScoreStep
                        label={`${scoreMatch.team_b_name || 'Team B'} score`}
                        value={scoreForm.set1_b}
                        max={99}
                        onChange={(n) => {
                          const next = { ...scoreForm, set1_b: n, status: 'COMPLETED' as string }
                          if (n > scoreForm.set1_a) next.winner_id = scoreMatch.team_b_id || ''
                          else if (n < scoreForm.set1_a) next.winner_id = scoreMatch.team_a_id || ''
                          setScoreForm(next)
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="org-score-meta">
                  <button
                    type="button"
                    className={`btn btn-sm ${scoreForm.status === 'WALKOVER' ? 'btn-dark' : 'btn-ghost'}`}
                    onClick={() =>
                      setScoreForm({
                        ...scoreForm,
                        status: scoreForm.status === 'WALKOVER' ? 'COMPLETED' : 'WALKOVER',
                      })
                    }
                  >
                    Walkover
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted-note" style={{ marginTop: 0 }}>
                  Best of 3. Tap + / −, then save.
                </p>
                <div className="score-sides-label">
                  <div>
                    <span className="muted-note">A</span>
                    <strong>{scoreMatch.team_a_name || 'Team A'}</strong>
                  </div>
                  <div>
                    <span className="muted-note">B</span>
                    <strong>{scoreMatch.team_b_name || 'Team B'}</strong>
                  </div>
                </div>
                <div className="score-grid">
                  {(
                    [
                      ['set1_a', 'set1_b', 'Set 1', 1] as const,
                      ['set2_a', 'set2_b', 'Set 2', 2] as const,
                      ...(scoreForm.set3_a > 0 ||
                      scoreForm.set3_b > 0 ||
                      scoreForm.current_set >= 3 ||
                      (scoreForm.set1_a !== scoreForm.set1_b &&
                        scoreForm.set2_a !== scoreForm.set2_b &&
                        (scoreForm.set1_a > scoreForm.set1_b) !==
                          (scoreForm.set2_a > scoreForm.set2_b))
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
                            value={scoreForm[ka]}
                            max={maxGames}
                            onChange={(n) =>
                              setScoreForm({
                                ...scoreForm,
                                [ka]: n,
                                current_set: Math.max(scoreForm.current_set, setNum),
                              })
                            }
                          />
                          <span className="pl-score-dash">–</span>
                          <ScoreStep
                            label={`${label} side B`}
                            value={scoreForm[kb]}
                            max={maxGames}
                            onChange={(n) =>
                              setScoreForm({
                                ...scoreForm,
                                [kb]: n,
                                current_set: Math.max(scoreForm.current_set, setNum),
                              })
                            }
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="org-score-meta">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Winner</label>
                    <select
                      className="form-select"
                      value={scoreForm.winner_id}
                      onChange={(e) => setScoreForm({ ...scoreForm, winner_id: e.target.value })}
                    >
                      <option value="">Auto from sets</option>
                      {scoreMatch.team_a_id && (
                        <option value={scoreMatch.team_a_id}>{scoreMatch.team_a_name}</option>
                      )}
                      {scoreMatch.team_b_id && (
                        <option value={scoreMatch.team_b_id}>{scoreMatch.team_b_name}</option>
                      )}
                    </select>
                  </div>
                </div>
              </>
            )}
            {scoreMatch.ratings_applied && (
              <p className="muted-note" style={{ margin: '0.75rem 0 0' }}>
                Ratings already applied - this corrects standings and the bracket only.
              </p>
            )}
            {scoreError && <p className="auth-error">{scoreError}</p>}
            <div className="modal-actions pl-score-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveScore}
                disabled={scoreMut.isPending}
              >
                {scoreMut.isPending
                  ? 'Saving…'
                  : scoreMatch.ratings_applied ||
                      scoreMatch.status === 'COMPLETED' ||
                      scoreMatch.status === 'WALKOVER'
                    ? 'Save correction'
                    : 'Save result'}
              </button>
              {(scoreMatch.status === 'COMPLETED' ||
                scoreMatch.status === 'WALKOVER' ||
                scoreMatch.status === 'AWAITING_CONFIRM') && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={clearScore}
                  disabled={scoreMut.isPending}
                  title="Undo result and put match back in the queue"
                >
                  Clear result
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setScoreMatch(null)
                  setScoreError('')
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {moveMatch && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMoveMatch(null)
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-match-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="move-match-title">Move match</h2>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              {moveMatch.team_a_name || 'TBD'} vs {moveMatch.team_b_name || 'TBD'}
            </p>
            <div className="form-group">
              <label className="form-label">Court</label>
              <select
                className="form-select"
                value={moveForm.court_number}
                onChange={(e) => setMoveForm({ ...moveForm, court_number: Number(e.target.value) })}
              >
                {(tournamentDetail?.courts || courtNumbers.map((n) => ({ number: n, name: `Court ${n}` }))).map(
                  (c: { number: number; name: string }) => (
                    <option key={c.number} value={c.number}>
                      {c.name}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Scheduled time</label>
              <input
                className="form-input"
                type="time"
                value={moveForm.scheduled_time}
                onChange={(e) => setMoveForm({ ...moveForm, scheduled_time: e.target.value })}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMoveMatch(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={moveMut.isPending}
                onClick={() => {
                  const data: Record<string, unknown> = { court_number: moveForm.court_number }
                  if (moveForm.scheduled_time) {
                    const datePart =
                      tournamentDetail?.event_date?.slice(0, 10) ||
                      (moveMatch.scheduled_start
                        ? String(moveMatch.scheduled_start).slice(0, 10)
                        : null) ||
                      new Date().toISOString().slice(0, 10)
                    data.scheduled_start = new Date(
                      `${datePart}T${moveForm.scheduled_time}:00`,
                    ).toISOString()
                  }
                  moveMut.mutate({ matchId: moveMatch.id, data })
                }}
              >
                {moveMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function AddTeamModal({
  tournamentId,
  playFormat = 'DOUBLES',
  friends,
  onClose,
  onAdded,
}: {
  tournamentId: string
  playFormat?: string
  friends: Array<{ user_id: string; full_name: string; university_short?: string | null }>
  onClose: () => void
  onAdded: (msg: string) => void
}) {
  const singles = playFormat === 'SINGLES'
  const [teamName, setTeamName] = useState('')
  const [player1Id, setPlayer1Id] = useState('')
  const [player2Id, setPlayer2Id] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<PlayerSearch[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: searchResults = [] } = useQuery({
    queryKey: ['player-search-org', search],
    queryFn: async () => (await communityApi.searchPlayers(search.trim())).data,
    enabled: search.trim().length >= 2,
  })

  const options = useMemo(() => {
    const byId = new Map<string, { user_id: string; full_name: string; university_short?: string | null }>()
    for (const f of friends) {
      byId.set(f.user_id, f)
    }
    for (const p of picked) {
      byId.set(p.id, {
        user_id: p.id,
        full_name: p.full_name,
        university_short: p.university_short,
      })
    }
    return Array.from(byId.values())
  }, [friends, picked])

  const addFromSearch = (p: PlayerSearch) => {
    setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
    if (!player1Id) setPlayer1Id(p.id)
    else if (!singles && !player2Id && p.id !== player1Id) setPlayer2Id(p.id)
    setSearch('')
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (teamName.trim().length < 2) {
      setError(singles ? 'Enter a player / entry name' : 'Enter a team name')
      return
    }
    if (!player1Id) {
      setError('Pick a player')
      return
    }
    if (!singles && (!player2Id || player1Id === player2Id)) {
      setError('Pick two different players')
      return
    }
    setSaving(true)
    try {
      await tournamentApi.adminAddTeam(tournamentId, {
        team_name: teamName.trim(),
        player1_id: player1Id,
        ...(singles ? {} : { player2_id: player2Id }),
      })
      onAdded(singles ? 'Player added (entry fee waived)' : 'Team added (entry fee waived)')
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not add entry'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (!saving && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-team-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="add-team-title">{singles ? 'Add player' : 'Add team'}</h2>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          {singles
            ? 'Adds a singles entry and marks them paid (fee waived).'
            : 'Adds a doubles pair and marks them paid (fee waived). Use friends or search by name.'}
        </p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="add-team-name">
              {singles ? 'Entry name' : 'Team name'}
            </label>
            <input
              id="add-team-name"
              className="form-input"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              required
              minLength={2}
              placeholder={singles ? 'e.g. Aoife Murphy' : 'e.g. UL Smash'}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="add-p1">
              {singles ? 'Player' : 'Player 1'}
            </label>
            <select
              id="add-p1"
              className="form-select"
              value={player1Id}
              onChange={(e) => setPlayer1Id(e.target.value)}
              required
            >
              <option value="">Select player</option>
              {options.map((p) => (
                <option key={p.user_id} value={p.user_id} disabled={p.user_id === player2Id}>
                  {p.full_name}
                  {p.university_short ? ` (${p.university_short})` : ''}
                </option>
              ))}
            </select>
          </div>
          {!singles && (
            <div className="form-group">
              <label className="form-label" htmlFor="add-p2">
                Player 2
              </label>
              <select
                id="add-p2"
                className="form-select"
                value={player2Id}
                onChange={(e) => setPlayer2Id(e.target.value)}
                required
              >
                <option value="">Select player</option>
                {options.map((p) => (
                  <option key={p.user_id} value={p.user_id} disabled={p.user_id === player1Id}>
                    {p.full_name}
                    {p.university_short ? ` (${p.university_short})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="add-search">
              Search players
            </label>
            <input
              id="add-search"
              className="form-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type a name"
              autoComplete="off"
            />
            {search.trim().length >= 2 && (
              <div className="org-search-results">
                {searchResults.length === 0 && <p className="muted-note">No matches</p>}
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="org-search-hit"
                    onClick={() => addFromSearch(p)}
                  >
                    <strong>{p.full_name}</strong>
                    <span>
                      {p.university_short || 'Player'} · {p.points} pts
                    </span>
                  </button>
                ))}
              </div>
            )}
            {friends.length === 0 && options.length === 0 && (
              <p className="muted-note">Add friends under Friends, or search for players above.</p>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Adding...' : singles ? 'Add player' : 'Add team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
