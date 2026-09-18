import axios from 'axios'
import { apiErrorMessage } from '../utils/errors'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('isp_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      const hadToken = !!localStorage.getItem('isp_token')
      if (hadToken && !error.config?.url?.includes('/auth/login')) {
        localStorage.removeItem('isp_token')
        localStorage.removeItem('isp_user')
        // Soft logout — let pages react via AuthContext refresh on next load
        if (!window.location.pathname.startsWith('/login')) {
          const next = encodeURIComponent(window.location.pathname + window.location.search)
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
  rules?: string | null
  description?: string | null
  status: string
  organiser_id: string
  match_duration_minutes: number
  group_size: number
  teams_advance_per_group: number
  registered_teams: number
}

export type Match = {
  id: string
  tournament_id: string
  round: string
  stage: string
  court_number?: number | null
  scheduled_start?: string | null
  team_a_id?: string | null
  team_b_id?: string | null
  team_a_name?: string | null
  team_b_name?: string | null
  team_a_placeholder?: string | null
  team_b_placeholder?: string | null
  status: string
  winner_id?: string | null
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
}

export const authApi = {
  register: (data: Record<string, unknown>) => api.post('/api/auth/register', data),
  login: (data: { email: string; password: string }) => api.post('/api/auth/login', data),
  me: () => api.get<User>('/api/auth/me'),
}

export const tournamentApi = {
  list: (params?: { status?: string; upcoming?: boolean }) =>
    api.get<Tournament[]>('/api/tournaments', { params }),
  get: (slugOrId: string) => api.get<Tournament>(`/api/tournaments/${slugOrId}`),
  create: (data: Record<string, unknown>) => api.post<Tournament>('/api/tournaments', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<Tournament>(`/api/tournaments/${id}`, data),
  register: (tournamentId: string, data: Record<string, unknown>) =>
    api.post(`/api/tournaments/${tournamentId}/register`, data),
  teams: (tournamentId: string) => api.get(`/api/tournaments/${tournamentId}/teams`),
  generate: (tournamentId: string, data?: Record<string, unknown>) =>
    api.post(`/api/tournaments/${tournamentId}/generate`, data || {}),
  matches: (slugOrId: string) => api.get<Match[]>(`/api/tournaments/${slugOrId}/matches`),
  standings: (slugOrId: string) => api.get(`/api/tournaments/${slugOrId}/standings`),
  playerView: (slugOrId: string) => api.get(`/api/tournaments/${slugOrId}/player-view`),
  display: (slugOrId: string) => api.get(`/api/tournaments/${slugOrId}/display`),
  announcements: (slugOrId: string) => api.get(`/api/tournaments/${slugOrId}/announcements`),
  createAnnouncement: (id: string, data: Record<string, unknown>) =>
    api.post(`/api/tournaments/${id}/announcements`, data),
  updateScore: (matchId: string, data: Record<string, unknown>) =>
    api.patch(`/api/matches/${matchId}/score`, data),
  moveMatch: (matchId: string, data: Record<string, unknown>) =>
    api.patch(`/api/matches/${matchId}`, data),
  checkIn: (tournamentId: string, teamId: string, data: Record<string, unknown>) =>
    api.post(`/api/tournaments/${tournamentId}/teams/${teamId}/check-in`, data),
  getRegistration: (id: string) => api.get<RegistrationConfirm>(`/api/registrations/${id}`),
  confirmPaymentSession: (sessionId: string) =>
    api.get<RegistrationConfirm>('/api/payments/confirm', { params: { session_id: sessionId } }),
}

export const platformApi = {
  universities: () => api.get<University[]>('/api/universities'),
  rankings: (limit = 50) => api.get<RankingRow[]>('/api/rankings', { params: { limit } }),
  player: (id: string) => api.get<RankingRow>(`/api/players/${id}`),
  organiserDashboard: () => api.get('/api/organiser/dashboard'),
}

export { apiErrorMessage }
export default api
