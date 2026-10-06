import axios from 'axios'
import { apiBaseUrl } from '../native/platform'
import { clearAuthStorage, getAuthToken } from '../utils/authStorage'

const api = axios.create({
  baseURL: apiBaseUrl(),
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
})

api.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    // Let the browser set multipart boundary
    delete config.headers['Content-Type']
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      const url = String(error.config?.url || '')
      const hadToken = !!getAuthToken()
      if (hadToken && !url.includes('/auth/login')) {
        clearAuthStorage()
        window.dispatchEvent(new Event('isp:logout'))

        // Only bounce to login on routes that require auth - public pages stay put
        const path = window.location.pathname
        const isTournamentJoin = /\/t\/[^/]+\/(join|confirmed)/.test(path)
        const isCommunityPrivate =
          path.startsWith('/community/') && !path.startsWith('/community/join/')
        const needsAuth =
          path.startsWith('/organiser') ||
          path.startsWith('/admin') ||
          isCommunityPrivate ||
          isTournamentJoin
        if (needsAuth && !path.startsWith('/login') && !path.startsWith('/signup')) {
          const next = encodeURIComponent(path + window.location.search)
          window.location.assign(`/login?next=${next}`)
        }
      }
    }
    return Promise.reject(error)
  },
)

export type User = {
  id: string
  email: string
  full_name: string
  phone?: string | null
  role: string
  university_id?: string | null
  student_number?: string | null
  is_active: boolean
}

export type Tournament = {
  id: string
  name: string
  slug: string
  location: string
  venue: string
  event_date: string
  start_time: string
  number_of_courts: number
  entry_fee_cents: number
  currency: string
  max_teams: number
  registration_deadline?: string | null
  format: string
  play_format?: string
  rules?: string | null
  description?: string | null
  status: string
  organiser_id: string
  match_duration_minutes: number
  group_size: number
  teams_advance_per_group: number
  registered_teams: number
  invite_code?: string | null
  courts?: Array<{ number: number; name: string; id: string }>
  can_manage?: boolean
}

export type TournamentAdmin = {
  id: string
  tournament_id: string
  user_id: string
  full_name: string
  email: string
  role: string
  is_owner: boolean
  created_at?: string | null
}

export type TournamentAnnouncement = {
  id: string
  tournament_id: string
  title: string
  body: string
  is_pinned: boolean
  created_at: string
}

export type Match = {
  id: string
  tournament_id: string
  round: string
  stage: string
  court_number?: number | null
  court_name?: string | null
  scheduled_start?: string | null
  team_a_id?: string | null
  team_b_id?: string | null
  team_a_name?: string | null
  team_b_name?: string | null
  team_a_placeholder?: string | null
  team_b_placeholder?: string | null
  status: string
  winner_id?: string | null
  ratings_applied?: boolean
  entered_by_id?: string | null
  confirmed_by_id?: string | null
  can_i_score?: boolean
  needs_my_confirm?: boolean
  score_submitted_by_me?: boolean
  score?: {
    set1_a: number
    set1_b: number
    set2_a: number
    set2_b: number
    set3_a: number
    set3_b: number
    current_set: number
  } | null
}

export type University = {
  id: string
  name: string
  short_name: string
  slug: string
}

export type ProfileMedia = {
  id: string
  media_type: string
  url: string
  caption?: string | null
  sort_order: number
  is_avatar: boolean
  created_at?: string | null
}

export type RankingRow = {
  id: string
  full_name: string
  university_name?: string | null
  university_short?: string | null
  points: number
  rank_ireland?: number | null
  tournaments_played: number
  matches_played: number
  wins: number
  losses: number
  bio?: string | null
  avatar_url?: string | null
  media?: ProfileMedia[]
  is_own_profile?: boolean
}

export type PlayerSearch = {
  id: string
  full_name: string
  university_short?: string | null
  points: number
  friendship_status?: string | null
}

export type Friendship = {
  id: string
  user_id: string
  full_name: string
  university_short?: string | null
  points: number
  status: string
  direction: 'incoming' | 'outgoing' | 'friend'
  created_at: string
}

export type CompetitionMember = {
  user_id: string
  full_name: string
  role: string
  points: number
  wins: number
  losses: number
  comp_wins: number
  comp_losses: number
}

export type Competition = {
  id: string
  name: string
  slug: string
  description?: string | null
  format: string
  status: string
  invite_code: string
  created_by_id: string
  created_by_name: string
  max_players: number
  number_of_courts: number
  member_count: number
  members: CompetitionMember[]
  is_member: boolean
  is_owner: boolean
}

export type RatingDelta = {
  user_id: string
  full_name: string
  delta: number
  rating_after: number
  won: boolean
}

export type CommunityMatch = {
  id: string
  competition_id: string
  competition_name?: string | null
  competition_slug?: string | null
  format: string
  status: string
  player_a1_id: string
  player_a1_name: string
  player_a2_id?: string | null
  player_a2_name?: string | null
  player_b1_id: string
  player_b1_name: string
  player_b2_id?: string | null
  player_b2_name?: string | null
  winner_side?: string | null
  set1_a: number
  set1_b: number
  set2_a: number
  set2_b: number
  set3_a: number
  set3_b: number
  played_at?: string | null
  notes?: string | null
  court_number?: number | null
  ratings_applied: boolean
  recorded_by_id?: string | null
  confirmed_by_id?: string | null
  needs_my_confirm: boolean
  can_i_score: boolean
  rating_changes: RatingDelta[]
}

export type NotificationItem = {
  id: string
  kind: string
  title: string
  body: string
  href: string
  created_at: string
  actionable: boolean
  friendship_id?: string | null
  match_id?: string | null
  actor_user_id?: string | null
  actor_name?: string | null
}

export type NotificationsFeed = {
  items: NotificationItem[]
  actionable_count: number
}

export type CommunityHome = {
  competitions: Competition[]
  needs_confirm: CommunityMatch[]
  needs_score: CommunityMatch[]
  my_next_matches: CommunityMatch[]
  friend_request_count: number
}

export type RegistrationConfirm = {
  registration_id: string
  status: string
  amount_cents: number
  currency: string
  paid_at?: string | null
  tournament: Tournament | null
  team_name: string
  players: string[]
  slot?: number | null
  can_leave?: boolean
}

export const authApi = {
  register: (data: Record<string, unknown>) => api.post('/api/auth/register', data),
  login: (data: { email: string; password: string }) => api.post('/api/auth/login', data),
  me: () => api.get<User>('/api/auth/me'),
  deleteAccount: (password: string) => api.delete('/api/auth/me', { data: { password } }),
}

export const tournamentApi = {
  list: (params?: { status?: string; upcoming?: boolean }) =>
    api.get<Tournament[]>('/api/tournaments', { params }),
  get: (slugOrId: string) => api.get<Tournament>(`/api/tournaments/${slugOrId}`),
  getByCode: (code: string) => api.get<Tournament>(`/api/tournaments/code/${code}`),
  create: (data: Record<string, unknown>) => api.post<Tournament>('/api/tournaments', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<Tournament>(`/api/tournaments/${id}`, data),
  delete: (id: string) => api.delete<{ ok: boolean; deleted: string }>(`/api/tournaments/${id}`),
  register: (tournamentId: string, data: Record<string, unknown>) =>
    api.post(`/api/tournaments/${tournamentId}/register`, data),
  organiserAddTeam: (tournamentId: string, data: Record<string, unknown>) =>
    api.post(`/api/tournaments/${tournamentId}/organiser-add-team`, data),
  teams: (tournamentId: string) => api.get(`/api/tournaments/${tournamentId}/teams`),
  generate: (tournamentId: string, data?: Record<string, unknown>) =>
    api.post(`/api/tournaments/${tournamentId}/generate`, data || {}),
  seedKnockout: (tournamentId: string) =>
    api.post(`/api/tournaments/${tournamentId}/seed-knockout`),
  matches: (slugOrId: string) => api.get<Match[]>(`/api/tournaments/${slugOrId}/matches`),
  standings: (slugOrId: string) => api.get(`/api/tournaments/${slugOrId}/standings`),
  playerView: (slugOrId: string) => api.get(`/api/tournaments/${slugOrId}/player-view`),
  display: (slugOrId: string) => api.get(`/api/tournaments/${slugOrId}/display`),
  announcements: (slugOrId: string) =>
    api.get<TournamentAnnouncement[]>(`/api/tournaments/${slugOrId}/announcements`),
  createAnnouncement: (id: string, data: Record<string, unknown>) =>
    api.post<TournamentAnnouncement>(`/api/tournaments/${id}/announcements`, data),
  updateAnnouncement: (tournamentId: string, announcementId: string, data: Record<string, unknown>) =>
    api.patch<TournamentAnnouncement>(
      `/api/tournaments/${tournamentId}/announcements/${announcementId}`,
      data,
    ),
  deleteAnnouncement: (tournamentId: string, announcementId: string) =>
    api.delete(`/api/tournaments/${tournamentId}/announcements/${announcementId}`),
  admins: (tournamentId: string) =>
    api.get<TournamentAdmin[]>(`/api/tournaments/${tournamentId}/admins`),
  addAdmin: (tournamentId: string, data: { user_id: string; role?: string }) =>
    api.post<TournamentAdmin>(`/api/tournaments/${tournamentId}/admins`, data),
  removeAdmin: (tournamentId: string, adminUserId: string) =>
    api.delete(`/api/tournaments/${tournamentId}/admins/${adminUserId}`),
  updateScore: (matchId: string, data: Record<string, unknown>) =>
    api.patch(`/api/matches/${matchId}/score`, data),
  playerSubmitScore: (
    matchId: string,
    data: {
      set1_a: number
      set1_b: number
      set2_a?: number
      set2_b?: number
      set3_a?: number
      set3_b?: number
    },
  ) => api.patch<Match>(`/api/matches/${matchId}/player-score`, data),
  confirmScore: (matchId: string) => api.post<Match>(`/api/matches/${matchId}/confirm-score`),
  cancelPendingScore: (matchId: string) =>
    api.post<Match>(`/api/matches/${matchId}/cancel-pending-score`),
  moveMatch: (matchId: string, data: Record<string, unknown>) =>
    api.patch(`/api/matches/${matchId}`, data),
  checkIn: (tournamentId: string, teamId: string, data: Record<string, unknown>) =>
    api.post(`/api/tournaments/${tournamentId}/teams/${teamId}/check-in`, data),
  withdrawTeam: (tournamentId: string, teamId: string) =>
    api.post(`/api/tournaments/${tournamentId}/teams/${teamId}/withdraw`),
  leaveTournament: (tournamentId: string) =>
    api.post(`/api/tournaments/${tournamentId}/leave`),
  getRegistration: (id: string) => api.get<RegistrationConfirm>(`/api/registrations/${id}`),
  confirmPaymentSession: (sessionId: string) =>
    api.get<RegistrationConfirm>('/api/payments/confirm', { params: { session_id: sessionId } }),
}

export const platformApi = {
  publicConfig: () =>
    api.get<{ demo_payments: boolean; stripe_publishable_key: string | null }>('/api/config/public'),
  universities: () => api.get<University[]>('/api/universities'),
  rankings: (limit = 50) => api.get<RankingRow[]>('/api/rankings', { params: { limit } }),
  resolveInvite: (code: string) =>
    api.get<{
      kind: 'tournament' | 'competition'
      slug: string
      name: string
      invite_code: string
      join_path: string
      hint: string
    }>(`/api/invite/${encodeURIComponent(code)}`),
  player: (id: string) => api.get<RankingRow>(`/api/players/${id}`),
  updateProfile: (data: { bio?: string; full_name?: string }) =>
    api.patch<RankingRow>('/api/me/profile', data),
  uploadMedia: (file: File, opts?: { caption?: string; set_as_avatar?: boolean }) => {
    const form = new FormData()
    form.append('file', file)
    if (opts?.caption) form.append('caption', opts.caption)
    if (opts?.set_as_avatar) form.append('set_as_avatar', 'true')
    // Videos can be up to 25MB — allow a longer timeout than the default 20s
    return api.post<ProfileMedia>('/api/me/profile/media', form, { timeout: 120_000 })
  },
  updateMediaCaption: (id: string, caption: string | null) =>
    api.patch<ProfileMedia>(`/api/me/profile/media/${id}`, { caption }),
  deleteMedia: (id: string) => api.delete(`/api/me/profile/media/${id}`),
  setAvatar: (id: string) => api.post<RankingRow>(`/api/me/profile/media/${id}/avatar`),
  clearAvatar: () => api.delete<RankingRow>('/api/me/profile/avatar'),
  organiserDashboard: () => api.get('/api/organiser/dashboard'),
}

export const reportApi = {
  create: (target_type: 'user' | 'media', target_id: string, reason: string) =>
    api.post<{ ok: boolean }>('/api/reports', { target_type, target_id, reason }),
}

export const communityApi = {
  home: () => api.get<CommunityHome>('/api/community/home'),
  notifications: () => api.get<NotificationsFeed>('/api/notifications'),
  searchPlayers: (q: string) => api.get<PlayerSearch[]>('/api/players/search', { params: { q } }),
  friends: () => api.get<Friendship[]>('/api/friends'),
  requestFriend: (user_id: string) => api.post<Friendship>('/api/friends/request', { user_id }),
  acceptFriend: (id: string) => api.post<Friendship>(`/api/friends/${id}/accept`),
  removeFriend: (id: string) => api.delete(`/api/friends/${id}`),
  competitions: () => api.get<Competition[]>('/api/competitions'),
  createCompetition: (data: Record<string, unknown>) =>
    api.post<Competition>('/api/competitions', data),
  getCompetition: (slugOrId: string) => api.get<Competition>(`/api/competitions/${slugOrId}`),
  joinByCode: (code: string) => api.post<Competition>(`/api/competitions/join/${code}`),
  inviteFriends: (id: string, friend_ids: string[]) =>
    api.post<Competition>(`/api/competitions/${id}/invite`, { friend_ids }),
  leaveCompetition: (id: string) => api.delete(`/api/competitions/${id}/leave`),
  removeMember: (id: string, userId: string) =>
    api.delete(`/api/competitions/${id}/members/${userId}`),
  setStatus: (id: string, status: string) =>
    api.patch<Competition>(`/api/competitions/${id}/status`, null, { params: { status } }),
  matches: (slugOrId: string) =>
    api.get<CommunityMatch[]>(`/api/competitions/${slugOrId}/matches`),
  createMatch: (competitionId: string, data: Record<string, unknown>) =>
    api.post<CommunityMatch>(`/api/competitions/${competitionId}/matches`, data),
  scoreMatch: (matchId: string, data: Record<string, unknown>) =>
    api.patch<CommunityMatch>(`/api/community-matches/${matchId}/score`, data),
  confirmMatch: (matchId: string) =>
    api.post<CommunityMatch>(`/api/community-matches/${matchId}/confirm`),
  setCourt: (matchId: string, court_number: number | null) =>
    api.patch<CommunityMatch>(`/api/community-matches/${matchId}/court`, { court_number }),
}

export { apiErrorMessage, apiErrorStatus } from '../utils/errors'
export default api
