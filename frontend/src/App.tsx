import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import NativeTabBar from './components/NativeTabBar'
import OfflineBanner from './components/OfflineBanner'
import { NativeDeepLinkRouter } from './native/NativeDeepLinkRouter'
import { apiBaseUrl, isNativeApp } from './native/platform'
import { communityApi, tournamentApi } from './services/api'
import { clearQueryCachePersist, restoreQueryCache, schedulePersistQueryCache } from './utils/queryPersist'

// Landing stays eager — first paint for web home. Everything else is code-split.
import Landing from './pages/Landing'
import NativeWelcomePage from './pages/NativeWelcomePage'

const LoginPage = lazy(() => import('./pages/Auth').then((m) => ({ default: m.LoginPage })))
const SignupPage = lazy(() => import('./pages/Auth').then((m) => ({ default: m.SignupPage })))
const TournamentsPage = lazy(() => import('./pages/TournamentsPage'))
const TournamentDetailPage = lazy(() => import('./pages/TournamentDetailPage'))
const JoinTournamentPage = lazy(() => import('./pages/JoinTournamentPage'))
const JoinTournamentByCodePage = lazy(() => import('./pages/JoinTournamentByCodePage'))
const JoinByCodePage = lazy(() => import('./pages/JoinByCodePage'))
const PlayerLivePage = lazy(() => import('./pages/PlayerLivePage'))
const TvDisplayPage = lazy(() => import('./pages/TvDisplayPage'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const OrganiserDashboard = lazy(() => import('./pages/OrganiserDashboard'))
const RankingsPage = lazy(() => import('./pages/RankingsPage'))
const PlayerProfilePage = lazy(() => import('./pages/PlayerProfilePage'))
const CommunityPage = lazy(() => import('./pages/CommunityPage'))
const CompetitionDetailPage = lazy(() => import('./pages/CompetitionDetailPage'))
const JoinCompetitionPage = lazy(() => import('./pages/JoinCompetitionPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))

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

/** Hit /health immediately so a sleeping Render free instance starts waking during JS parse. */
function wakeApiEarly() {
  const base = apiBaseUrl()
  if (!base) return
  void fetch(`${base}/health`, { method: 'GET', mode: 'cors', cache: 'no-store', keepalive: true }).catch(
    () => {},
  )
}

function PrefetchWarmup() {
  const { user, token } = useAuth()
  const { pathname } = useLocation()

  useEffect(() => {
    wakeApiEarly()

    // Align with Landing / Tournaments upcoming queries — not a dead ['tournaments'] key
    if (pathname === '/' || pathname.startsWith('/tournaments')) {
      void queryClient.prefetchQuery({
        queryKey: ['tournaments', 'upcoming'],
        queryFn: async () => (await tournamentApi.list({ upcoming: true })).data,
        staleTime: 60_000,
      })
    }

    if (!token || !user) return

    const runAuthPrefetch = () => {
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
    }

    // Defer logged-in prefetches so they don't compete with first paint / cold start
    const ric = window.requestIdleCallback?.bind(window)
    if (ric) {
      const id = ric(runAuthPrefetch, { timeout: 3500 })
      return () => window.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(runAuthPrefetch, 2000)
    return () => window.clearTimeout(t)
  }, [token, user?.id, pathname])

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

function RootRoute() {
  if (isNativeApp()) return <NativeWelcomePage />
  return <Landing />
}

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '40vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#0b3d2e',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 600,
      }}
      aria-busy="true"
    >
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AuthPersistBridge>
            <NativeDeepLinkRouter />
            <OfflineBanner />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<RootRoute />} />
                <Route path="/welcome" element={<NativeWelcomePage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
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
                    <ProtectedRoute>
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
            </Suspense>
            <NativeTabBar />
          </AuthPersistBridge>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
