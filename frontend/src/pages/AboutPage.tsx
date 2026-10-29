import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { appHomePath } from '../utils/navigation'
import './Blog.css'
import './Legal.css'

export default function AboutPage() {
  const { user } = useAuth()
  const backTo = appHomePath(user?.role)

  usePageSeo({
    title: 'About Student Padel Ireland',
    description:
      'About Student Padel Ireland - the platform for student padel tournaments, community games, live scores, and Ireland rankings.',
    path: '/about',
  })

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page legal-page">
        <p className="eyebrow">
          <Link to={backTo}>← Home</Link>
        </p>
        <h1 className="page-title">About Student Padel Ireland</h1>
        <p className="page-sub">Ireland’s student padel competition platform</p>

        <div className="legal-body">
          <p>
            <strong>Student Padel Ireland</strong> (SPI) is built for university and college padel players across
            Ireland. Find tournaments, join with an invite code, run community ladders with friends, follow live
            scores, and climb a national ranking - all in one place.
          </p>

          <h2>What we offer</h2>
          <ul>
            <li>Public tournament listings with registration and payments</li>
            <li>Community competitions and friend ladders</li>
            <li>Live scoring for players, organisers, and venue displays</li>
            <li>Ireland rankings fed by tournament and community results</li>
          </ul>

          <h2>Where students play</h2>
          <p>
            Events and community games run nationwide, including Dublin, Cork, Galway, Limerick, Belfast, and
            Waterford. Whether you are in a large Dublin society or starting a new campus group, SPI gives you the
            same tools.
          </p>

          <h2>Contact</h2>
          <p>
            Questions or partnership ideas:{' '}
            <a href="mailto:jkdoherty123@gmail.com">jkdoherty123@gmail.com</a>
          </p>

          <div className="about-links">
            <Link to="/signup" className="btn btn-primary">
              Create an account
            </Link>
            <Link to="/tournaments" className="btn btn-ghost">
              Browse tournaments
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
