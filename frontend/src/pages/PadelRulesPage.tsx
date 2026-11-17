import { Link } from 'react-router-dom'
import BackButton from '../components/BackButton'
import NavBar from '../components/NavBar'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { appHomePath } from '../utils/navigation'
import './Legal.css'

/**
 * Plain-English padel basics for student / social events.
 * Aligned with common FIP / LTA club guidance (not a full rulebook).
 */
export default function PadelRulesPage() {
  const { user } = useAuth()
  usePageSeo({
    title: 'Common padel rules',
    description:
      'Simple padel rules for student and social tournaments: serve, glass walls, mesh, lets, and scoring.',
    path: '/padel-rules',
  })

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page legal-page">
        <BackButton fallbackTo={appHomePath(user?.role)} />
        <h1 className="page-title">Common padel rules</h1>
        <p className="page-sub">
          Basics for social and student play. Your event page wins if it posts different scoring.
        </p>

        <div className="legal-body">
          <h2>The court</h2>
          <ul>
            <li>Doubles: four players, two vs two, on an enclosed court with glass and mesh.</li>
            <li>The ball can bounce once on the floor, then rebound off the walls.</li>
          </ul>

          <h2>Serve</h2>
          <ul>
            <li>
              <strong>Underarm only.</strong> Bounce the ball, then hit it at or below waist height
              with at least one foot on the ground.
            </li>
            <li>
              Stand behind the service line (do not step on it). Serve diagonally into the opposite
              service box. Lines count as in.
            </li>
            <li>Two serves: a fault on first gives you a second; two faults lose the point.</li>
            <li>Start each game from the right side, then alternate sides every point.</li>
            <li>The receiver must let the serve bounce before returning it.</li>
          </ul>

          <h2>Serve off the glass</h2>
          <ul>
            <li>
              After a legal serve lands in the box, it may hit the <strong>back or side glass</strong>{' '}
              and stay in play.
            </li>
            <li>
              If the serve bounces in the box and then hits the <strong>mesh / fence</strong> before
              the second bounce, it is a <strong>fault</strong>.
            </li>
            <li>
              Net cord that then lands in the correct box is a <strong>let</strong> — replay the
              serve (full point if it was a first-serve let).
            </li>
          </ul>

          <h2>Walls in a rally</h2>
          <ul>
            <li>
              <strong>Floor first on their side.</strong> Your shot must bounce on the opponents’
              floor before it touches their glass or mesh. Wall first on their side = you lose the
              point.
            </li>
            <li>
              After one bounce on your side, the ball may hit your <strong>glass</strong> (including
              corners) and you can still play it before the second bounce.
            </li>
            <li>
              You may not play the ball off your own <strong>mesh / fence</strong> — that loses the
              point.
            </li>
            <li>You can volley after the return of serve; the serve itself must bounce.</li>
          </ul>

          <h2>What’s out</h2>
          <ul>
            <li>Second bounce on the floor before you hit it.</li>
            <li>Ball hits the mesh on the fly (before bouncing) on the opponents’ side.</li>
            <li>Ball goes over the fence / out of court where that is not allowed.</li>
            <li>Ball hits you or your partner (usually loses the point).</li>
          </ul>

          <h2>Lets</h2>
          <ul>
            <li>Replay if the ball breaks, something invades the court, or play is unfairly interrupted.</li>
            <li>Call a let straight away — if you play on, you usually lose the right to claim it.</li>
          </ul>

          <h2>Scoring at social events</h2>
          <ul>
            <li>
              Many student events use <strong>first to 21 points</strong> (every rally = 1 point), or
              whoever is ahead when the timed slot ends — check your event page.
            </li>
            <li>
              Classic padel uses games and sets (15–30–40). Organisers may still choose best of 3 for
              longer matches.
            </li>
            <li>Golden point / no-ad: at deuce, one deciding point wins the game (common in timed events).</li>
          </ul>

          <h2>Etiquette</h2>
          <ul>
            <li>Be ready on time; leave the court promptly when your slot ends.</li>
            <li>Agree the score after each point if needed; settle disputes with an organiser.</li>
            <li>Look after the court and other players — this is a social sport.</li>
          </ul>

          <p>
            Event-specific scoring always wins when it is posted on the tournament page. For the full
            competition rulebook, see the{' '}
            <a
              href="https://www.padelfip.com/wp-content/uploads/2024/11/FIP-Rules-of-Padel.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              International Padel Federation rules (PDF)
            </a>
            .
          </p>

          <p>
            <Link to="/tournaments">Browse tournaments</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
