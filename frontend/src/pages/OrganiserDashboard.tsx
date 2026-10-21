import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { ShareQr } from '../components/ShareQr'
import { confirmDialog } from '../components/ConfirmDialog'
import CreateTournamentModal from '../components/CreateTournamentModal'
import EditTournamentModal from '../components/EditTournamentModal'
import NumberInput from '../components/NumberInput'
import TournamentBracket from '../components/TournamentBracket'
import { useAuth } from '../context/AuthContext'
import { publicPathUrl } from '../native/platform'
import {
  apiErrorMessage,
  communityApi,
  platformApi,
  tournamentApi,
  type Match,
  type OrganiserDashRow,
  type PlayerSearch,
  type TournamentTeam,
} from '../services/api'
import {
  bracketFormatHint,
  courtLabel,
  formatMatchScore,
  formatMoney,
  formatTime,
  statusBadgeClass,
  tournamentFormatSummary,
} from '../utils/format'
import {
  formatGroupSizes,
  knockoutRoundLabel,
  previewDraw,
} from '../utils/drawPreview'
import { mediaUrl } from '../utils/media'
import './Organiser.css'

/** Respect organiser selection; only bump when a higher set already has games. */
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

export default function OrganiserDashboard() {
  const { user, loading: authLoading } = useAuth()
  const qc = useQueryClient()
  const [params, setSearchParams] = useSearchParams()
  const canOrganise = !!user
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['organiser-dashboard'],
    queryFn: async () => (await platformApi.organiserDashboard()).data,
    enabled: canOrganise,
  })

  const [toast, setToast] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(params.get('t'))
  const [showCreate, setShowCreate] = useState(params.get('create') === '1')
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
  const [matchFilter, setMatchFilter] = useState<'active' | 'all' | 'done'>('active')
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'owing'>('all')
  const [scoreForm, setScoreForm] = useState({
    set1_a: 0,
    set1_b: 0,
    set2_a: 0,
    set2_b: 0,
    set3_a: 0,
    set3_b: 0,
    current_set: 1,
    status: 'LIVE',
    winner_id: '',
    force: false,
  })
  const [scoreError, setScoreError] = useState('')

  useEffect(() => {
    const t = params.get('t')
    if (t) setSelectedId(t)
    if (params.get('create') === '1') setShowCreate(true)
  }, [params])

  useEffect(() => {
    setPaymentFilter('all')
    setSponsorForm({ name: '', website: '', featured: false, logo: null })
    setSponsorLogoKey((k) => k + 1)
  }, [selectedId])

  useEffect(() => {
    const open = showCreate || showEdit || confirmGenerate || !!scoreMatch || showAddTeam || !!moveMatch
    document.body.classList.toggle('modal-open', open)
    return () => document.body.classList.remove('modal-open')
  }, [showCreate, showEdit, confirmGenerate, scoreMatch, showAddTeam, moveMatch])

  useEffect(() => {
    if (!confirmGenerate && !scoreMatch && !showAddTeam && !moveMatch && !showEdit) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setConfirmGenerate(false)
      setScoreMatch(null)
      setShowAddTeam(false)
      setMoveMatch(null)
      setShowEdit(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmGenerate, scoreMatch, showAddTeam, moveMatch, showEdit])

  const tournaments: OrganiserDashRow[] = data?.tournaments || []

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
    if (selectedId && tournaments.length > 0 && !tournaments.some((t) => t.tournament.id === selectedId)) {
      setSelectedId(tournaments[0]?.tournament.id ?? null)
    }
  }, [selectedId, tournaments])

  const { data: teams = [] } = useQuery({
    queryKey: ['org-teams', tid],
    queryFn: async () => (await tournamentApi.teams(tid!)).data,
    enabled: !!tid && canOrganise,
  })

  const { data: matches = [] } = useQuery({
    queryKey: ['org-matches', slug],
    queryFn: async () => (await tournamentApi.matches(slug!)).data,
    enabled: !!slug && canOrganise,
    refetchInterval: 10000,
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
    qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
    qc.invalidateQueries({ queryKey: ['tournaments'] })
    if (slug) {
      qc.invalidateQueries({ queryKey: ['tournament', slug] })
      qc.invalidateQueries({ queryKey: ['matches', slug] })
      qc.invalidateQueries({ queryKey: ['display', slug] })
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
    mutationFn: () => tournamentApi.generate(tid!),
    onSuccess: (res) => {
      setConfirmGenerate(false)
      qc.invalidateQueries({ queryKey: ['org-matches'] })
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

  const seedKoMut = useMutation({
    mutationFn: () => tournamentApi.seedKnockout(tid!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      invalidateTournamentPublic()
      const d = res.data as { filled?: number }
      showToast(`Knockout seeded · ${d.filled ?? 0} slots filled`)
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not seed knockout')),
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
      qc.setQueryData(['organiser-dashboard'], (old: unknown) => {
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
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      qc.invalidateQueries({ queryKey: ['tournament-admins', tid] })
      qc.invalidateQueries({ queryKey: ['tournament', slug] })
      showToast('Ownership transferred')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not transfer ownership')),
  })

  const announceMut = useMutation({
    mutationFn: () => tournamentApi.createAnnouncement(tid!, announce),
    onSuccess: () => {
      setAnnounce({ title: '', body: '' })
      qc.invalidateQueries({ queryKey: ['player-view', slug] })
      qc.invalidateQueries({ queryKey: ['announcements', slug] })
      showToast('Announcement posted — visible on player live')
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
    mutationFn: () =>
      tournamentApi.createSponsor(tid!, {
        name: sponsorForm.name.trim(),
        website: sponsorForm.website.trim() || undefined,
        featured: sponsorForm.featured,
        logo: sponsorForm.logo,
      }),
    onSuccess: () => {
      setSponsorForm({ name: '', website: '', featured: false, logo: null })
      setSponsorLogoKey((k) => k + 1)
      qc.invalidateQueries({ queryKey: ['sponsors', slug] })
      showToast('Sponsor added — shown on the tournament page')
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

  const scoreMut = useMutation({
    mutationFn: () => {
      const current_set = resolveCurrentSet(scoreForm)
      return tournamentApi.updateScore(scoreMatch!.id, {
        ...scoreForm,
        current_set,
        winner_id: scoreForm.winner_id || null,
        force: scoreForm.force || !!scoreMatch?.ratings_applied,
      })
    },
    onSuccess: () => {
      setScoreMatch(null)
      setScoreError('')
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      qc.invalidateQueries({ queryKey: ['rankings'] })
      qc.invalidateQueries({ queryKey: ['player-view'] })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      if (slug) {
        qc.invalidateQueries({ queryKey: ['matches', slug] })
        qc.invalidateQueries({ queryKey: ['display', slug] })
      }
      showToast('Score saved')
    },
    onError: (e: unknown) => {
      const msg = apiErrorMessage(e, 'Could not save score')
      setScoreError(msg)
      showToast(msg)
    },
  })

  const saveScore = () => {
    setScoreError('')
    if (scoreForm.status === 'COMPLETED' || scoreForm.status === 'WALKOVER') {
      const hasWinner = !!scoreForm.winner_id
      const setWon =
        (scoreForm.set1_a !== scoreForm.set1_b ? 1 : 0) +
        (scoreForm.set2_a !== scoreForm.set2_b ? 1 : 0) +
        (scoreForm.set3_a !== scoreForm.set3_b && (scoreForm.set3_a > 0 || scoreForm.set3_b > 0) ? 1 : 0)
      if (!hasWinner && setWon === 0) {
        setScoreError('Pick a winner or enter set scores that decide the match before marking completed.')
        return
      }
    }
    scoreMut.mutate()
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
    onSuccess: (_data, vars) => {
      setMoveMatch(null)
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      qc.invalidateQueries({ queryKey: ['player-view'] })
      if (slug) {
        qc.invalidateQueries({ queryKey: ['matches', slug] })
        qc.invalidateQueries({ queryKey: ['display', slug] })
      }
      if (!vars.silent) showToast('Match updated')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not update match')),
  })

  const checkInMut = useMutation({
    mutationFn: (teamId: string) =>
      tournamentApi.checkIn(tid!, teamId, { player1_present: true, player2_present: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-teams'] })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      showToast(isSingles ? 'Player checked in' : 'Team checked in')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Check-in failed')),
  })

  const collectFeeMut = useMutation({
    mutationFn: (teamId: string) => tournamentApi.markFeeCollected(tid!, teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-teams'] })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      showToast('Marked as paid')
    },
    onError: (e: unknown) => showToast(apiErrorMessage(e, 'Could not mark as paid')),
  })

  const withdrawMut = useMutation({
    mutationFn: (teamId: string) => tournamentApi.withdrawTeam(tid!, teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-teams'] })
      qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
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
    const list = [...orgTeams]
    list.sort((a, b) => {
      const rank = (t: TournamentTeam) => {
        if (t.payment_status === 'PENDING' || t.payment_status === 'FAILED') return 0
        if (t.payment_status === 'PAID' && t.payment_via === 'pay_on_arrival') return 1
        if (t.payment_status === 'PAID') return 2
        return 3
      }
      const d = rank(a) - rank(b)
      if (d !== 0) return d
      return a.name.localeCompare(b.name)
    })
    if (paymentFilter === 'all') return list
    return list.filter((t) => paymentBucket(t) === paymentFilter)
  }, [orgTeams, paymentFilter])

  const paymentLabel = (team: TournamentTeam) => {
    if (team.payment_via === 'pay_on_arrival') return 'Not paid · venue'
    if (team.payment_via === 'collected_on_arrival') return 'Paid · in person'
    if (team.payment_via === 'free_entry') return 'Free'
    if (team.payment_via === 'online' || team.payment_via === 'demo_payment') return 'Paid · online'
    if (team.payment_status === 'PENDING') return 'Not paid · checkout'
    if (team.payment_status === 'PAID') return 'Paid'
    if (team.payment_status === 'FAILED') return 'Payment failed'
    if (team.payment_status === 'CANCELLED') return 'Cancelled'
    return team.payment_status || '—'
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
      teamCount: paidCount,
      groupSize: tournamentDetail?.group_size ?? 4,
      teamsAdvancePerGroup: tournamentDetail?.teams_advance_per_group ?? 2,
      format: activeFormat,
    })
  }, [active, paidCount, tournamentDetail?.group_size, tournamentDetail?.teams_advance_per_group, activeFormat])
  const canGenerate = paidCount >= 2 && !!drawPreview?.ok
  const canAddTeams =
    !!active &&
    active.tournament.status !== 'COMPLETED' &&
    active.tournament.status !== 'CANCELLED' &&
    active.tournament.status !== 'LIVE' &&
    !fixturesExist

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
    return matches.filter((m) => {
      if (courtFilter !== 'all' && String(m.court_number) !== courtFilter) return false
      if (matchFilter === 'active') {
        return (
          m.status === 'SCHEDULED' ||
          m.status === 'CALLED' ||
          m.status === 'LIVE' ||
          m.status === 'AWAITING_CONFIRM'
        )
      }
      if (matchFilter === 'done') {
        return m.status === 'COMPLETED' || m.status === 'WALKOVER' || m.status === 'CANCELLED'
      }
      return true
    })
  }, [matches, courtFilter, matchFilter])

  const hasKnockoutMatches = matches.some((m) => m.stage === 'KNOCKOUT')

  useEffect(() => {
    if (matchView === 'bracket' && !hasKnockoutMatches) {
      setMatchView('list')
    }
  }, [matchView, hasKnockoutMatches])

  const openScore = (m: Match) => {
    if (!m.team_a_id || !m.team_b_id) return
    setScoreError('')
    setScoreMatch(m)
    const defaultStatus =
      m.status === 'COMPLETED' || m.status === 'WALKOVER'
        ? m.status
        : m.status === 'AWAITING_CONFIRM'
          ? 'COMPLETED'
          : 'LIVE'
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

  const renderMatchActions = (m: Match, compact = false) => {
    const canScore = !!(m.team_a_id && m.team_b_id)
    if (!canScore) return null
    const locked = !!m.ratings_applied
    const done = m.status === 'COMPLETED' || m.status === 'WALKOVER' || m.status === 'CANCELLED'
    const pending = m.status === 'AWAITING_CONFIRM'
    const onScore = () => {
      if (m.status === 'SCHEDULED') {
        moveMut.mutate(
          { matchId: m.id, data: { status: 'CALLED' }, silent: true },
          { onSuccess: () => openScore({ ...m, status: 'CALLED' }) },
        )
        return
      }
      openScore(m)
    }
    return (
      <div className="org-match-actions">
        {!compact && (
          <span className={`badge ${statusBadgeClass(m.status)}`}>
            {m.status === 'CALLED'
              ? 'Called'
              : m.status === 'AWAITING_CONFIRM'
                ? 'Needs confirm'
                : m.status.replace(/_/g, ' ')}
          </span>
        )}
        {m.status === 'SCHEDULED' && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={moveMut.isPending}
            title="Call players to this court"
            onClick={() => moveMut.mutate({ matchId: m.id, data: { status: 'CALLED' } })}
          >
            Call to court
          </button>
        )}
        {m.status === 'CALLED' && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={moveMut.isPending}
            title="Mark the match as live"
            onClick={() => moveMut.mutate({ matchId: m.id, data: { status: 'LIVE' } })}
          >
            Start live
          </button>
        )}
        {(m.status === 'LIVE' || m.status === 'CALLED' || m.status === 'SCHEDULED' || pending) && (
          <button
            type="button"
            className="btn btn-dark btn-sm"
            disabled={moveMut.isPending}
            onClick={onScore}
            title={pending ? 'Override and finalise as organiser' : 'Enter score'}
          >
            {pending ? 'Finalise' : 'Score'}
          </button>
        )}
        {done && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openScore(m)}>
            {locked ? 'Correct' : 'Score'}
          </button>
        )}
        {!done && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openMove(m)}>
            Move
          </button>
        )}
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
          <h1 className="page-title">Host a tournament</h1>
          <p className="page-sub">Create an account or log in to run your own events.</p>
          <div className="header-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link to="/signup?next=/organiser" className="btn btn-primary">
              Sign up
            </Link>
            <Link to="/login?next=/organiser" className="btn btn-ghost">
              Log in
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
          <p className="org-nav-label">My events</p>
          {tournaments.map((t) => (
            <button
              key={t.tournament.id}
              className={`org-nav-item ${active?.tournament.id === t.tournament.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedId(t.tournament.id)
                setSearchParams({ t: t.tournament.id }, { replace: true })
              }}
            >
              {t.tournament.name}
            </button>
          ))}
          <button className="btn btn-ghost btn-block" onClick={() => setShowCreate(true)}>
            + New tournament
          </button>
          <div className="org-aside-note">
            <strong>Running an event?</strong>
            <p>Registration, payments, and live scoring in one place.</p>
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
              <h1>Running an event?</h1>
              <p>
                Set up registration, payments, and live scoring. Events you create here are private —
                players join with your invite code (they won’t appear on the landing page).
              </p>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                Create a tournament
              </button>
            </div>
          )}

          {active && (
            <>
              <header className="org-header">
                <div>
                  <h1>{active.tournament.name}</h1>
                  <p>
                    {active.tournament.status.replace(/_/g, ' ')} ·{' '}
                    {tournamentFormatSummary(activePlayFormat, activeFormat)} ·{' '}
                    <Link to={`/t/${active.tournament.slug}`}>Public page</Link> ·{' '}
                    <Link to={`/tournament/${active.tournament.slug}/display`}>TV display</Link>
                  </p>
                </div>
                <div className="org-header-actions">
                  {tournamentDetail && (
                    <button type="button" className="btn btn-ghost" onClick={() => setShowEdit(true)}>
                      Edit
                    </button>
                  )}
                  {active.tournament.status === 'DRAFT' && (
                    <button className="btn btn-primary" onClick={() => openMut.mutate()} disabled={openMut.isPending}>
                      Open registration
                    </button>
                  )}
                  {active.tournament.status === 'REGISTRATION_OPEN' && !fixturesExist && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => closeRegMut.mutate()}
                        disabled={closeRegMut.isPending}
                      >
                        Close registration
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => setConfirmGenerate(true)}
                        disabled={generateMut.isPending || !canGenerate}
                        title={
                          paidCount < 2
                            ? 'Need at least 2 paid entries before generating'
                            : undefined
                        }
                      >
                        Generate draw
                      </button>
                    </>
                  )}
                  {active.tournament.status === 'REGISTRATION_OPEN' && fixturesExist && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setConfirmGenerate(true)}
                        disabled={generateMut.isPending || !canGenerate}
                        title={
                          paidCount < 2
                            ? 'Need at least 2 paid entries before generating'
                            : undefined
                        }
                      >
                        Re-generate
                      </button>
                      <button className="btn btn-primary" onClick={() => goLiveMut.mutate()} disabled={goLiveMut.isPending}>
                        Go LIVE
                      </button>
                    </>
                  )}
                  {active.tournament.status === 'REGISTRATION_CLOSED' && !fixturesExist && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => openMut.mutate()}
                        disabled={openMut.isPending}
                      >
                        Reopen registration
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => setConfirmGenerate(true)}
                        disabled={generateMut.isPending || !canGenerate}
                        title={
                          paidCount < 2
                            ? 'Need at least 2 paid entries before generating'
                            : undefined
                        }
                      >
                        Generate draw
                      </button>
                    </>
                  )}
                  {active.tournament.status === 'REGISTRATION_CLOSED' && fixturesExist && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => openMut.mutate()}
                        disabled={openMut.isPending}
                      >
                        Reopen registration
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setConfirmGenerate(true)}
                        disabled={generateMut.isPending || !canGenerate}
                        title={
                          paidCount < 2
                            ? 'Need at least 2 paid entries before generating'
                            : undefined
                        }
                      >
                        Re-generate
                      </button>
                      <button className="btn btn-primary" onClick={() => goLiveMut.mutate()} disabled={goLiveMut.isPending}>
                        Go LIVE
                      </button>
                    </>
                  )}
                  {active.tournament.status === 'LIVE' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        void confirmDialog({
                          title: 'Mark completed?',
                          message: 'This ends the tournament for players on the live board.',
                          confirmLabel: 'Mark completed',
                        }).then((ok) => {
                          if (ok) completeMut.mutate()
                        })
                      }}
                      disabled={completeMut.isPending}
                    >
                      Mark completed
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
                          message: 'Players will not see this event until you open registration again.',
                          confirmLabel: 'Restore',
                        }).then((ok) => {
                          if (ok) restoreMut.mutate()
                        })
                      }}
                    >
                      {restoreMut.isPending ? 'Restoring…' : 'Restore as draft'}
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

              <section className="org-section">
                <h2>Invite players</h2>
                {active.tournament.status === 'DRAFT' ? (
                  <p className="muted org-section-lead">
                    Open registration first — players can’t join while this event is still a draft.
                  </p>
                ) : active.tournament.status === 'REGISTRATION_OPEN' ? (
                  <p className="muted org-section-lead">
                    Share this code or QR. Friends tap <strong>Have a code?</strong> on Tournaments.
                  </p>
                ) : fixturesExist ? (
                  <p className="muted org-section-lead">
                    Registration is closed and the draw is live — new players can’t join this code.
                    Share the live board instead if people want scores.
                  </p>
                ) : (
                  <p className="muted org-section-lead">
                    Registration is closed. Re-open it if you still need more players before generating
                    the draw.
                  </p>
                )}
                {inviteCode && active.tournament.status === 'REGISTRATION_OPEN' ? (
                  <div className="org-invite">
                    <div className="org-invite-code">
                      <span className="org-invite-label">Join code</span>
                      <code className="share-code">{inviteCode}</code>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyInviteCode()}>
                        {codeCopied ? 'Copied' : 'Copy code'}
                      </button>
                    </div>
                    {joinUrl && <ShareQr url={joinUrl} openLabel="Open join page" />}
                  </div>
                ) : inviteCode && active.tournament.status === 'DRAFT' ? (
                  <p className="muted">Join code is ready and will appear here after you open registration.</p>
                ) : inviteCode && fixturesExist ? (
                  <p className="muted">
                    Live board:{' '}
                    <Link to={`/t/${active.tournament.slug}/live`}>/t/{active.tournament.slug}/live</Link>
                  </p>
                ) : inviteCode ? (
                  <p className="muted">Join code stays available if you re-open registration.</p>
                ) : (
                  <p className="muted">Invite code will appear once the tournament is saved.</p>
                )}
              </section>

              <section className="org-section">
                <div className="org-section-head">
                  <h2>Who’s paid</h2>
                  {canAddTeams && (
                    <button type="button" className="btn btn-dark btn-sm" onClick={() => setShowAddTeam(true)}>
                      {isSingles ? 'Add player' : 'Add team'}
                    </button>
                  )}
                </div>
                {!canAddTeams && fixturesExist && (
                  <p className="muted org-section-lead">
                    Fixtures already generated — add players before generate, or regenerate (replaces the draw).
                  </p>
                )}

                {orgTeams.length > 0 && (
                  <div className="org-pay-toolbar">
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
                    {paymentCounts.owing > 0 ? (
                      <p className="org-pay-hint">
                        {paymentCounts.collect > 0 && (
                          <>
                            <strong>{paymentCounts.collect}</strong> in the draw — tap{' '}
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
                    const unpaidEntry =
                      team.payment_status === 'PENDING' ||
                      team.payment_status === 'CANCELLED' ||
                      team.payment_status === 'FAILED' ||
                      team.payment_status === 'REFUNDED'
                    return (
                      <div key={team.id} className={`org-row org-pay-row${owing ? ' is-owing' : ''}`}>
                        <div>
                          <strong>{team.name}</strong>
                          <span>{team.player_names?.join(' / ')}</span>
                          <span className={paymentBadgeClass(team)}>{paymentLabel(team)}</span>
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
                          {team.checked_in ? (
                            <span className="checked">✓ In</span>
                          ) : team.payment_status === 'PAID' && !canCollect ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => checkInMut.mutate(team.id)}
                            >
                              Check in
                            </button>
                          ) : team.payment_status === 'PAID' && canCollect ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                void confirmDialog({
                                  title: 'Check in before collecting?',
                                  message: `${team.name} still owes at the venue. Check them in anyway?`,
                                  confirmLabel: 'Check in',
                                }).then((ok) => {
                                  if (ok) checkInMut.mutate(team.id)
                                })
                              }}
                            >
                              Check in
                            </button>
                          ) : null}
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
                                      ? ' They haven’t paid online — this just frees the spot.'
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
                      {paymentFilter === 'paid'
                        ? 'Nobody marked paid yet.'
                        : paymentFilter === 'owing'
                          ? 'Everyone here is paid.'
                          : 'No entries to show.'}
                    </p>
                  )}
                </div>
              </section>

              <section className="org-section">
                <div className="org-section-head">
                  <h2>Matches & scoring</h2>
                  {matches.some((m) => m.stage === 'KNOCKOUT' && (!m.team_a_id || !m.team_b_id)) &&
                    matches.some((m) => m.stage === 'GROUP') && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={seedKoMut.isPending}
                        onClick={() => seedKoMut.mutate()}
                      >
                        {seedKoMut.isPending ? 'Seeding…' : 'Seed knockout'}
                      </button>
                    )}
                </div>
                {matches.length > 0 && (
                  <p className="muted org-section-lead">
                    <strong>Call to court</strong> notifies players · <strong>Start live</strong> begins scoring ·{' '}
                    <strong>Move</strong> changes court or time
                  </p>
                )}
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
                        By court
                      </button>
                      {hasKnockoutMatches && (
                        <button
                          type="button"
                          className={`btn btn-sm ${matchView === 'bracket' ? 'btn-dark' : 'btn-ghost'}`}
                          onClick={() => setMatchView('bracket')}
                        >
                          Bracket
                        </button>
                      )}
                    </div>
                    {matchView !== 'bracket' && (
                      <select
                        className="form-select"
                        value={matchFilter}
                        onChange={(e) => setMatchFilter(e.target.value as 'active' | 'all' | 'done')}
                        aria-label="Filter matches by status"
                      >
                        <option value="active">Active (scheduled / called / live)</option>
                        <option value="done">Completed</option>
                        <option value="all">All matches</option>
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
                    <TournamentBracket matches={matches.filter((m) => m.stage === 'KNOCKOUT')} />
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
                              {courtMatches.map((m) => (
                                <div key={m.id} className={`org-court-card is-${m.status.toLowerCase()}`}>
                                  <strong>
                                    {m.team_a_name || m.team_a_placeholder || 'TBD'} vs{' '}
                                    {m.team_b_name || m.team_b_placeholder || 'TBD'}
                                  </strong>
                                  <span>
                                    {m.status.replace(/_/g, ' ')}
                                    {m.score ? ` · ${formatMatchScore(m.score)}` : ''}
                                    {m.scheduled_start ? ` · ${formatTime(m.scheduled_start)}` : ''}
                                  </span>
                                  {renderMatchActions(m, true)}
                                </div>
                              ))}
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
                    {filteredMatches.map((m) => {
                      const canScore = !!(m.team_a_id && m.team_b_id)
                      return (
                        <div
                          key={m.id}
                          className={`org-row ${m.status === 'CALLED' ? 'is-called' : ''} ${m.status === 'LIVE' ? 'is-live' : ''}`}
                        >
                          <div>
                            <strong>
                              {m.round.replace(/_/g, ' ')} · {courtLabel(m.court_name, m.court_number)}
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
                            ) : (
                              <span className="badge badge-draft">Waiting for teams</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {matches.length === 0 && (
                      <p className="muted">Generate the tournament to create fixtures.</p>
                    )}
                    {matches.length > 0 && filteredMatches.length === 0 && (
                      <p className="muted">No matches match this filter.</p>
                    )}
                  </div>
                )}
              </section>

              <section className="org-section">
                <h2>Announcements</h2>
                <p className="muted org-section-lead">Posted notes appear on the player live page.</p>
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
                              title: 'Delete announcement?',
                              message: `Delete “${a.title}”?`,
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
                    placeholder="Court 4 matches delayed by 10 minutes"
                    value={announce.body}
                    onChange={(e) => setAnnounce({ ...announce, body: e.target.value })}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!announce.title || !announce.body || announceMut.isPending}
                  onClick={() => announceMut.mutate()}
                >
                  Post announcement
                </button>
              </section>

              <section className="org-section">
                <h2>Sponsors</h2>
                <p className="muted org-section-lead">
                  Shows as a “Supported by” strip on the tournament page. Tap the box to add a logo — PNG or JPG
                  works best (max 2MB).
                </p>
                {sponsors.length > 0 && (
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
                        <img src={sponsorPreview} alt="" className="org-sponsor-preview" />
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
                            showToast('Use JPG or PNG — iPhone HEIC photos aren’t supported yet')
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
                    onClick={() => sponsorMut.mutate()}
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
                <p className="muted org-section-lead">
                  Co-admins can edit the event, score matches, manage teams, sponsors, and post announcements.
                  {isOwner
                    ? ' Only the owner can add or remove admins, transfer ownership, or delete the tournament.'
                    : ' Ask the owner if you need changes to this admin list.'}
                </p>
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
        </main>
      </div>

      {showCreate && (
        <CreateTournamentModal
          onClose={() => setShowCreate(false)}
          onToast={showToast}
          onCreated={(msg, id) => {
            showToast(msg)
            if (id) setSelectedId(id)
          }}
        />
      )}

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
            qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
            qc.invalidateQueries({ queryKey: ['tournament', slug] })
          }}
        />
      )}

      {confirmGenerate && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (!generateMut.isPending && e.target === e.currentTarget) setConfirmGenerate(false)
          }}
        >
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generate-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="generate-modal-title">
              {fixturesExist ? 'Re-generate draw?' : 'Generate draw?'}
            </h2>
            <p className="org-gen-lead">
              {activeFormat === 'ROUND_ROBIN' ? (
                <>
                  Builds fixtures from <strong>paid</strong> entries only so everyone plays everyone.
                  Registration will close.
                </>
              ) : (
                <>
                  Builds groups, fixtures, and the knockout from <strong>paid</strong> entries only.
                  Empty spots are skipped — the draw fits whoever has paid. Registration will close.
                </>
              )}
            </p>
            {fixturesExist && (
              <p className="org-gen-warn" role="alert">
                Existing matches and groups will be replaced.
              </p>
            )}
            <p className="org-gen-meta">
              {tournamentFormatSummary(activePlayFormat, activeFormat)}. {bracketFormatHint(activeFormat)}
            </p>

            <div className="org-gen-stats">
              <div>
                <span>Paid entries</span>
                <strong>
                  {paidCount}
                  {maxTeams > 0 ? ` / ${maxTeams}` : ''}
                </strong>
              </div>
              {unpaidCount > 0 && (
                <div>
                  <span>Incomplete (excluded)</span>
                  <strong>{unpaidCount}</strong>
                </div>
              )}
              {paymentCounts.collect > 0 && (
                <div>
                  <span>Pay on arrival (in draw)</span>
                  <strong>{paymentCounts.collect}</strong>
                </div>
              )}
              {drawPreview?.ok && (
                <>
                  <div>
                    <span>Groups</span>
                    <strong>
                      {drawPreview.groupCount}{' '}
                      <span className="org-gen-sub">({formatGroupSizes(drawPreview.groupSizes)})</span>
                    </strong>
                  </div>
                  <div>
                    <span>Matches</span>
                    <strong>{drawPreview.totalMatches}</strong>
                  </div>
                </>
              )}
            </div>

            {paidCount > 0 && maxTeams > 0 && paidCount < maxTeams && (
              <p className="org-gen-note">
                Field isn’t full ({maxTeams - paidCount} spot
                {maxTeams - paidCount === 1 ? '' : 's'} left). That’s fine — groups will be sized evenly
                from the {paidCount} paid {isSingles ? 'player' : 'team'}
                {paidCount === 1 ? '' : 's'}.
              </p>
            )}

            {drawPreview?.ok && activeFormat !== 'ROUND_ROBIN' && (
              <ul className="org-gen-list">
                <li>
                  Top {drawPreview.advancePerGroup} per group advance
                  {drawPreview.advanceAdjusted
                    ? ` (adjusted from ${drawPreview.requestedAdvance} to fit smaller groups)`
                    : ''}
                </li>
                {drawPreview.knockoutRounds.length > 0 ? (
                  <li>
                    Knockout starts at {knockoutRoundLabel(drawPreview.knockoutRounds[0])}
                    {drawPreview.byeSlots > 0
                      ? ` · ${drawPreview.byeSlots} bye${drawPreview.byeSlots === 1 ? '' : 's'} for the bracket`
                      : ''}
                  </li>
                ) : (
                  <li>{drawPreview.note || 'Group stage only'}</li>
                )}
              </ul>
            )}

            {drawPreview && !drawPreview.ok && (
              <p className="org-gen-warn" role="alert">
                {drawPreview.error}
              </p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmGenerate(false)}
                disabled={generateMut.isPending}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={generateMut.isPending || !canGenerate}
                onClick={() => generateMut.mutate()}
              >
                {generateMut.isPending
                  ? 'Generating…'
                  : fixturesExist
                    ? 'Replace draw'
                    : 'Generate draw'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scoreMatch && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setScoreMatch(null)
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-entry-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="score-entry-title">Enter score</h2>
            <p>
              {scoreMatch.team_a_name || 'Team A'} vs {scoreMatch.team_b_name || 'Team B'}
            </p>
            {scoreMatch.status === 'AWAITING_CONFIRM' && (
              <p className="muted-note" style={{ marginTop: 0 }}>
                Players haven’t confirmed yet. Saving as Completed finalises this match for them.
              </p>
            )}
            {(['set1', 'set2', 'set3'] as const).map((set) => (
              <div key={set} className="score-row">
                <label>{set.replace('set', 'Set ')}</label>
                <NumberInput
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  emptyValue={0}
                  aria-label={`${set.replace('set', 'Set ')} team A`}
                  value={scoreForm[`${set}_a` as 'set1_a']}
                  onValueChange={(n) => {
                    const setNum = Number(set.replace('set', '')) || 1
                    setScoreForm({
                      ...scoreForm,
                      [`${set}_a`]: Math.max(0, Math.trunc(n)),
                      current_set: Math.max(scoreForm.current_set, setNum),
                    })
                  }}
                />
                <span>-</span>
                <NumberInput
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  emptyValue={0}
                  aria-label={`${set.replace('set', 'Set ')} team B`}
                  value={scoreForm[`${set}_b` as 'set1_b']}
                  onValueChange={(n) => {
                    const setNum = Number(set.replace('set', '')) || 1
                    setScoreForm({
                      ...scoreForm,
                      [`${set}_b`]: Math.max(0, Math.trunc(n)),
                      current_set: Math.max(scoreForm.current_set, setNum),
                    })
                  }}
                />
              </div>
            ))}
            <div className="form-group">
              <label className="form-label">Current set (shown on TV / live)</label>
              <select
                className="form-select"
                value={scoreForm.current_set}
                onChange={(e) => setScoreForm({ ...scoreForm, current_set: Number(e.target.value) })}
              >
                <option value={1}>Set 1</option>
                <option value={2}>Set 2</option>
                <option value={3}>Set 3</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select
                className="form-select"
                value={scoreForm.status}
                onChange={(e) => setScoreForm({ ...scoreForm, status: e.target.value })}
              >
                <option value="LIVE">Live</option>
                <option value="COMPLETED">Completed</option>
                <option value="WALKOVER">Walkover</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Winner (when completed)</label>
              <select
                className="form-select"
                value={scoreForm.winner_id}
                onChange={(e) => setScoreForm({ ...scoreForm, winner_id: e.target.value })}
              >
                <option value="">Auto from scores</option>
                {scoreMatch.team_a_id && (
                  <option value={scoreMatch.team_a_id}>{scoreMatch.team_a_name}</option>
                )}
                {scoreMatch.team_b_id && (
                  <option value={scoreMatch.team_b_id}>{scoreMatch.team_b_name}</option>
                )}
              </select>
            </div>
            {scoreMatch.ratings_applied && (
              <p className="muted-note" style={{ marginBottom: '0.75rem' }}>
                This match already affected Ireland ratings. Saving corrects standings and the bracket only.
              </p>
            )}
            {scoreError && <p className="auth-error">{scoreError}</p>}
            <div className="modal-actions">
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
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveScore}
                disabled={scoreMut.isPending}
              >
                {scoreMut.isPending ? 'Saving...' : scoreMatch.ratings_applied ? 'Correct score' : 'Save score'}
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
      await tournamentApi.organiserAddTeam(tournamentId, {
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
              <p className="muted-note">Add friends in Community, or search for players above.</p>
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
