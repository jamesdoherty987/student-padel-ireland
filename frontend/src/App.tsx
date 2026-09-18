import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import Landing from './pages/Landing'
import { LoginPage, SignupPage } from './pages/Auth'
import TournamentsPage from './pages/TournamentsPage'
import TournamentDetailPage from './pages/TournamentDetailPage'
import JoinTournamentPage from './pages/JoinTournamentPage'
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/tournaments" element={<TournamentsPage />} />
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
            <Route
              path="/community"
              element={
                <ProtectedRoute>
                  <CommunityPage />
                </ProtectedRoute>
              }
            />
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
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
