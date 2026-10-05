import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NavBar from '../components/NavBar'
import { ShareQr } from '../components/ShareQr'
import EditTournamentModal from '../components/EditTournamentModal'
import NumberInput from '../components/NumberInput'
import TournamentFormFields, { type TournamentFormState } from '../components/TournamentFormFields'
import { useAuth } from '../context/AuthContext'
import { publicPathUrl } from '../native/platform'
import {
  apiErrorMessage,
  communityApi,
  platformApi,
  tournamentApi,
  type Match,
  type PlayerSearch,
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
  const [params] = useSearchParams()
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
  const [adminQuery, setAdminQuery] = useState('')
  const [adminResults, setAdminResults] = useState<PlayerSearch[]>([])
  const [adminSearching, setAdminSearching] = useState(false)
  const adminSearchSeq = useRef(0)
  const [scoreMatch, setScoreMatch] = useState<Match | null>(null)
  const [moveMatch, setMoveMatch] = useState<Match | null>(null)
  const [moveForm, setMoveForm] = useState({ court_number: 1, scheduled_time: '' })
  const [matchView, setMatchView] = useState<'list' | 'courts'>('list')
  const [courtFilter, setCourtFilter] = useState<string>('all')
  const [matchFilter, setMatchFilter] = useState<'active' | 'all' | 'done'>('active')
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

  const tournaments = (data?.tournaments || []) as Array<{
    tournament: {
      id: string
      name: string
      slug: string
      status: string
      max_teams: number
      play_format?: string
      format?: string
    }
    teams: number
    players: number
    revenue_cents: number
    paid_registrations: number
    live_matches: number
    completed_matches: number
    checked_in: number
    is_owner?: boolean
    can_manage_admins?: boolean
  }>

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
    }
  }

  const generateMut = useMutation({
    mutationFn: () => tournamentApi.generate(tid!),
    onSuccess: (res) => {
      setConfirmGenerate(false)
      qc.invalidateQueries({ queryKey: ['org-matches'] })
      invalidateTournamentPublic()
      const d = res.data as { matches?: number; groups?: number }
      const matchesN = d.matches ?? 0
      const groupsN = d.groups ?? 0
      if (activeFormat === 'ROUND_ROBIN' || groupsN === 0) {
        showToast(`Generated ${matchesN} round-robin match${matchesN === 1 ? '' : 'es'}`)
      } else {
        showToast(`Generated ${groupsN} groups · ${matchesN} matches`)
      }
    },
    onError: (e: unknown) => {
      showToast(apiErrorMessage(e, 'Generate failed. You need at least 2 paid teams.'))
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
        return m.status === 'SCHEDULED' || m.status === 'CALLED' || m.status === 'LIVE'
      }
      if (matchFilter === 'done') {
        return m.status === 'COMPLETED' || m.status === 'WALKOVER' || m.status === 'CANCELLED'
      }
      return true
    })
  }, [matches, courtFilter, matchFilter])

  const openScore = (m: Match) => {
    if (!m.team_a_id || !m.team_b_id) return
    setScoreError('')
    setScoreMatch(m)
    setScoreForm({
      set1_a: m.score?.set1_a ?? 0,
      set1_b: m.score?.set1_b ?? 0,
      set2_a: m.score?.set2_a ?? 0,
      set2_b: m.score?.set2_b ?? 0,
      set3_a: m.score?.set3_a ?? 0,
      set3_b: m.score?.set3_b ?? 0,
      current_set: m.score?.current_set ?? 1,
      status: m.status === 'COMPLETED' || m.status === 'WALKOVER' ? m.status : 'LIVE',
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
            {m.status === 'CALLED' ? 'Called' : m.status.replace(/_/g, ' ')}
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
        {(m.status === 'LIVE' || m.status === 'CALLED' || m.status === 'SCHEDULED') && (
          <button
            type="button"
            className="btn btn-dark btn-sm"
            disabled={moveMut.isPending}
            onClick={onScore}
          >
            Score
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
          <p className="page-sub">Log in to create and run your own events.</p>
          <Link to="/login?next=/organiser" className="btn btn-primary">
            Log in
          </Link>
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
              onClick={() => setSelectedId(t.tournament.id)}
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
          {isLoading && <p>Loading...</p>}
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
                Set up registration, payments, and live scoring. Create a tournament to get started —
                anyone signed in can host.
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
                        disabled={generateMut.isPending}
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
                        disabled={generateMut.isPending}
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
                        disabled={generateMut.isPending}
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
                        disabled={generateMut.isPending}
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
                        if (window.confirm('Mark this tournament as completed?')) completeMut.mutate()
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
                        if (window.confirm('Restore this tournament as a draft?')) {
                          restoreMut.mutate()
                        }
                      }}
                    >
                      {restoreMut.isPending ? 'Restoring…' : 'Restore as draft'}
                    </button>
                  )}
                  {active.tournament.status !== 'CANCELLED' &&
                    active.tournament.status !== 'COMPLETED' && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={cancelMut.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Cancel this tournament? Players will no longer be able to register or play.',
                            )
                          ) {
                            cancelMut.mutate()
                          }
                        }}
                      >
                        Cancel event
                      </button>
                    )}
                  {isOwner && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={deleteMut.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Permanently delete "${active.tournament.name}"? This removes teams, matches, and scores. This cannot be undone.`,
                          )
                        ) {
                          deleteMut.mutate()
                        }
                      }}
                    >
                      {deleteMut.isPending ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
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
                  <span>Revenue</span>
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
                ) : (
                  <p className="muted org-section-lead">
                    Share this code or QR. Friends tap <strong>Have a code?</strong> on Tournaments.
                  </p>
                )}
                {inviteCode && active.tournament.status !== 'DRAFT' ? (
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
                ) : (
                  <p className="muted">Invite code will appear once the tournament is saved.</p>
                )}
              </section>

              <section className="org-section">
                <div className="org-section-head">
                  <h2>{isSingles ? 'Players & check-in' : 'Teams & check-in'}</h2>
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
                <div className="org-table">
                  {(teams as Array<{ id: string; name: string; player_names: string[]; checked_in: boolean; payment_status: string }>).map(
                    (team) => (
                      <div key={team.id} className="org-row">
                        <div>
                          <strong>{team.name}</strong>
                          <span>{team.player_names?.join(' / ')}</span>
                        </div>
                        <div className="org-row-right">
                          <span className={`badge ${team.payment_status === 'PAID' ? 'badge-open' : 'badge-draft'}`}>
                            {team.payment_status || '-'}
                          </span>
                          {team.checked_in ? (
                            <span className="checked">✓ Checked in</span>
                          ) : team.payment_status === 'PAID' ? (
                            <button className="btn btn-ghost btn-sm" onClick={() => checkInMut.mutate(team.id)}>
                              Check in
                            </button>
                          ) : null}
                          {(team.payment_status === 'PENDING' ||
                            team.payment_status === 'CANCELLED' ||
                            team.payment_status === 'FAILED' ||
                            team.payment_status === 'REFUNDED') && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={withdrawMut.isPending}
                              onClick={() => {
                                if (window.confirm(`Remove unpaid entry ${team.name}?`)) {
                                  withdrawMut.mutate(team.id)
                                }
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
                                  const msg = `${base} Entry fees are not refunded automatically.`
                                  if (window.confirm(msg)) {
                                    withdrawMut.mutate(team.id)
                                  }
                                }}
                              >
                                Withdraw
                              </button>
                            )}
                        </div>
                      </div>
                    ),
                  )}
                  {teams.length === 0 && (
                    <p className="muted">
                      {isSingles
                        ? 'No players registered yet. Share the invite or add a player.'
                        : 'No teams registered yet. Share the invite or add a team.'}
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
                    </div>
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
                            if (window.confirm(`Delete announcement “${a.title}”?`)) {
                              deleteAnnounceMut.mutate(a.id)
                            }
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
                <h2>Tournament admins</h2>
                <p className="muted org-section-lead">
                  Co-admins can edit the event, score matches, manage teams, and post announcements.
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
                              if (
                                window.confirm(
                                  `Transfer ownership to ${a.full_name}? The previous owner stays as a co-admin.`,
                                )
                              ) {
                                transferOwnerMut.mutate(a.user_id)
                              }
                            }}
                          >
                            Make owner
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={removeAdminMut.isPending}
                            onClick={() => {
                              if (window.confirm(`Remove ${a.full_name} as admin?`)) {
                                removeAdminMut.mutate(a.user_id)
                              }
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
        <div className="modal-backdrop" onClick={() => setConfirmGenerate(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generate-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="generate-modal-title">Generate tournament?</h2>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
              {activeFormat === 'ROUND_ROBIN' ? (
                <>
                  This builds the round-robin fixtures from <strong>paid</strong> entries so everyone plays
                  everyone. Registration will close.
                </>
              ) : (
                <>
                  This builds groups, fixtures, and the knockout bracket from <strong>paid</strong> entries.
                  Registration will close.
                </>
              )}
              {matches.length > 0 && (
                <>
                  {' '}
                  <strong style={{ color: 'var(--danger)' }}>
                    Existing matches and groups will be replaced.
                  </strong>
                </>
              )}
            </p>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.92rem' }}>
              {tournamentFormatSummary(activePlayFormat, activeFormat)}. {bracketFormatHint(activeFormat)}
            </p>
            <p style={{ marginBottom: '1rem' }}>
              Paid teams ready: <strong>{active?.paid_registrations ?? 0}</strong>
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmGenerate(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={generateMut.isPending || (active?.paid_registrations ?? 0) < 2}
                onClick={() => generateMut.mutate()}
              >
                {generateMut.isPending ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scoreMatch && (
        <div className="modal-backdrop" onClick={() => setScoreMatch(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-entry-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="score-entry-title">Enter score</h2>
            <p>
              {scoreMatch.team_a_name || 'Team A'} vs {scoreMatch.team_b_name || 'Team B'}
            </p>
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
        <div className="modal-backdrop" onClick={() => setMoveMatch(null)}>
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
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-team-title"
        onClick={(e) => e.stopPropagation()}
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

function CreateTournamentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (msg: string, id?: string) => void
}) {
  const qc = useQueryClient()
  const [openRegistration, setOpenRegistration] = useState(true)
  const [form, setForm] = useState<TournamentFormState>({
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
    description: '',
    rules: '',
    group_size: 4,
    teams_advance_per_group: 2,
  })
  const [courtNames, setCourtNames] = useState<string[]>(
    Array.from({ length: 6 }, (_, i) => `Court ${i + 1}`),
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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
      const { data } = await tournamentApi.create({
        name: form.name.trim(),
        location: form.location.trim(),
        venue: form.venue.trim(),
        event_date: form.event_date,
        start_time: form.start_time.length === 5 ? `${form.start_time}:00` : form.start_time,
        number_of_courts: form.number_of_courts,
        court_names: courtNames.map((n, i) => n.trim() || `Court ${i + 1}`),
        entry_fee_cents: Math.round(form.entry_fee_euros * 100),
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
      if (openRegistration) {
        try {
          await tournamentApi.update(data.id, { status: 'REGISTRATION_OPEN' })
        } catch {
          await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
          await qc.invalidateQueries({ queryKey: ['tournaments'] })
          onCreated('Tournament created, but registration could not be opened — open it from My events', data.id)
          onClose()
          return
        }
      }
      await qc.invalidateQueries({ queryKey: ['organiser-dashboard'] })
      await qc.invalidateQueries({ queryKey: ['tournaments'] })
      onCreated(
        openRegistration ? 'Tournament created — registration is open' : 'Tournament created as draft',
        data.id,
      )
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Could not create tournament'))
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
        aria-labelledby="create-tournament-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tf-modal-head">
          <div>
            <h2 id="create-tournament-title">Create tournament</h2>
            <p className="tf-modal-sub">
              Set the format, courts, and fee. Players will see a clear summary on the public page.
            </p>
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
            mode="create"
            openRegistration={openRegistration}
            onOpenRegistrationChange={setOpenRegistration}
          />

          {error && <p className="auth-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : openRegistration ? 'Create & open registration' : 'Create draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
