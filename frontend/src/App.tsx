import { useEffect, useRef, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { NativeDeepLinkRouter } from './native/NativeDeepLinkRouter'
import Landing from './pages/Landing'
import { LoginPage, SignupPage } from './pages/Auth'
import TournamentsPage from './pages/TournamentsPage'
import TournamentDetailPage from './pages/TournamentDetailPage'
import JoinTournamentPage from './pages/JoinTournamentPage'
import JoinTournamentByCodePage from './pages/JoinTournamentByCodePage'
import JoinByCodePage from './pages/JoinByCodePage'
import PlayerLivePage from './pages/PlayerLivePage'
import TvDisplayPage from './pages/TvDisplayPage'
import AdminDashboard from './pages/AdminDashboard'
import OrganiserDashboard from './pages/OrganiserDashboard'
import RankingsPage from './pages/RankingsPage'
import PlayerProfilePage from './pages/PlayerProfilePage'
import CommunityPage from './pages/CommunityPage'
import CompetitionDetailPage from './pages/CompetitionDetailPage'
import JoinCompetitionPage from './pages/JoinCompetitionPage'
import NotFoundPage from './pages/NotFoundPage'
import { communityApi, platformApi, tournamentApi } from './services/api'
import { clearQueryCachePersist, restoreQueryCache, schedulePersistQueryCache } from './utils/queryPersist'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 1000 * 60 * 30,
      retry: 1,
      retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 4000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

restoreQueryCache(queryClient)
queryClient.getQueryCache().subscribe(() => {
  schedulePersistQueryCache(queryClient)
})

function PrefetchWarmup() {
  const { user, token } = useAuth()
  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: ['tournaments'],
      queryFn: async () => (await tournamentApi.list()).data,
      staleTime: 60_000,
    })
    void queryClient.prefetchQuery({
      queryKey: ['rankings'],
      queryFn: async () => (await platformApi.rankings(100)).data,
      staleTime: 60_000,
    })
    if (!token || !user) return
    void queryClient.prefetchQuery({
      queryKey: ['friends'],
      queryFn: async () => (await communityApi.friends()).data,
      staleTime: 60_000,
    })
    void queryClient.prefetchQuery({
      queryKey: ['community-home'],
      queryFn: async () => (await communityApi.home()).data,
      staleTime: 45_000,
    })
    void queryClient.prefetchQuery({
      queryKey: ['notifications'],
      queryFn: async () => (await communityApi.notifications()).data,
      staleTime: 30_000,
    })
  }, [token, user?.id])
  return null
}

function AuthPersistBridge({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const wasLoggedIn = useRef(false)
  useEffect(() => {
    if (user) {
      wasLoggedIn.current = true
      return
    }
    if (wasLoggedIn.current) {
      clearQueryCachePersist()
      queryClient.clear()
      wasLoggedIn.current = false
    }
  }, [user])
  return (
    <>
      <PrefetchWarmup />
      {children}
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AuthPersistBridge>
            <NativeDeepLinkRouter />
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/tournaments" element={<TournamentsPage />} />
              <Route path="/join" element={<JoinByCodePage />} />
              <Route path="/join/:code" element={<JoinByCodePage />} />
              <Route path="/t/join/:code" element={<JoinTournamentByCodePage />} />
              <Route path="/t/:slug" element={<TournamentDetailPage />} />
              <Route
                path="/t/:slug/join"
                element={
                  <ProtectedRoute>
                    <JoinTournamentPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/t/:slug/live" element={<PlayerLivePage />} />
              <Route
                path="/t/:slug/confirmed"
                element={
                  <ProtectedRoute>
                    <JoinTournamentPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/tournament/:id/display" element={<TvDisplayPage />} />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/organiser"
                element={
                  <ProtectedRoute roles={['ORGANISER', 'ADMIN']}>
                    <OrganiserDashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/rankings" element={<RankingsPage />} />
              <Route path="/community" element={<CommunityPage />} />
              <Route path="/community/join/:code" element={<JoinCompetitionPage />} />
              <Route
                path="/community/:slug"
                element={
                  <ProtectedRoute>
                    <CompetitionDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/players/:id" element={<PlayerProfilePage />} />
              <Route path="/404" element={<NotFoundPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthPersistBridge>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
