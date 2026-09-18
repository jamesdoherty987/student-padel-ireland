import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { platformApi, tournamentApi, type Tournament } from '../services/api'
import { formatDate, formatMoney, statusBadgeClass, statusLabel } from '../utils/format'
import './Landing.css'

export default function Landing() {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('mobile-menu-open', menuOpen)
    return () => document.body.classList.remove('mobile-menu-open')
  }, [menuOpen])

  const { data: tournaments = [], isLoading: loadingTournaments } = useQuery({
    queryKey: ['tournaments', 'upcoming'],
    queryFn: async () => (await tournamentApi.list({ upcoming: true })).data,
  })
  const { data: allTournaments = [] } = useQuery({
    queryKey: ['tournaments', 'all-home'],
    queryFn: async () => (await tournamentApi.list()).data,
  })
  const { data: rankings = [] } = useQuery({
    queryKey: ['rankings', 'home'],
    queryFn: async () => (await platformApi.rankings(8)).data,
  })
  const { data: universities = [] } = useQuery({
    queryKey: ['universities'],
    queryFn: async () => (await platformApi.universities()).data,
  })

  const list = tournaments.length > 0 ? tournaments : allTournaments.slice(0, 6)
  const close = () => setMenuOpen(false)

  const createHref =
    user?.role === 'ORGANISER' || user?.role === 'ADMIN'
      ? '/organiser'
      : user
        ? '/organiser'
        : '/signup?role=ORGANISER'

  return (
    <div className="landing">
      <header className={`lp-header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="lp-header-inner">
          <a href="#top" className="lp-logo" onClick={close}>
            Student Padel Ireland
          </a>
          <nav className={`lp-nav ${menuOpen ? 'is-open' : ''}`}>
            <a href="#tournaments" onClick={close}>
              Tournaments
            </a>
            <a href="#how" onClick={close}>
              How it works
            </a>
            <a href="#rankings" onClick={close}>
              Rankings
            </a>
            {user ? (
              <Link
                to={user.role === 'ORGANISER' || user.role === 'ADMIN' ? '/organiser' : '/tournaments'}
                className="lp-nav-cta"
                onClick={close}
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" onClick={close}>
                  Log in
                </Link>
                <Link to="/signup" className="lp-nav-cta" onClick={close}>
                  Sign up
                </Link>
              </>
            )}
          </nav>
          <button
            type="button"
            className="lp-menu-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <i className={`fas ${menuOpen ? 'fa-times' : 'fa-bars'}`} />
          </button>
        </div>
      </header>

      <main id="top">
        <section className="lp-hero">
          <div className="lp-hero-frame">
            <p className="lp-kicker">Student padel · Ireland</p>
            <h1>Find a tournament. Enter with your partner. Follow scores live.</h1>
            <p className="lp-lead">
              Student Padel Ireland is the place to browse events, register your team, pay entry, and
              check fixtures from your phone on the day.
            </p>
            <div className="lp-actions">
              <a href="#tournaments" className="btn btn-primary">
                Browse tournaments
              </a>
              {user ? (
                <Link to="/tournaments" className="btn btn-outline">
                  My tournaments
                </Link>
              ) : (
                <Link to="/signup" className="btn btn-outline">
                  Create account
                </Link>
              )}
            </div>
          </div>
        </section>

        <section id="tournaments" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <div>
                <h2>Tournaments</h2>
                <p>Open an event to join, see fixtures, or follow live scores.</p>
              </div>
              <Link to="/tournaments" className="lp-text-link">
                View all
              </Link>
            </div>

            {loadingTournaments && <p className="lp-muted">Loading tournaments…</p>}

            {!loadingTournaments && list.length === 0 && (
              <div className="lp-empty">
                <p>No tournaments listed yet.</p>
                <Link to={createHref} className="btn btn-primary">
                  Create a tournament
                </Link>
              </div>
            )}

            <ul className="lp-event-list">
              {list.map((t: Tournament) => (
                <li key={t.id}>
                  <Link to={`/t/${t.slug}`} className="lp-event">
                    <div className="lp-event-main">
                      <h3>{t.name}</h3>
                      <p>
                        {t.location} · {t.venue} · {formatDate(t.event_date)}
                      </p>
                    </div>
                    <div className="lp-event-side">
                      <span className={`badge ${statusBadgeClass(t.status)}`}>
                        {statusLabel(t.status)}
                      </span>
                      <span className="lp-event-meta">
                        {t.registered_teams}/{t.max_teams} teams ·{' '}
                        {formatMoney(t.entry_fee_cents, t.currency)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="lp-organiser-note">
              <p>Running an event at your university?</p>
              <Link to={createHref} className="btn btn-dark">
                Create a tournament
              </Link>
            </div>
          </div>
        </section>

        <section id="how" className="lp-section lp-section-alt">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <div>
                <h2>How it works</h2>
                <p>Three steps — no app download needed.</p>
              </div>
            </div>
            <ol className="lp-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Find an event</strong>
                  <p>Pick a tournament above and open the page for details, rules, and entry.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Register your team</strong>
                  <p>Sign up, add your partner, and pay the entry fee online.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Play and follow scores</strong>
                  <p>On the day, open the tournament link for your next match, standings, and live courts.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section id="rankings" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <div>
                <h2>Rankings</h2>
                <p>National standings after verified results.</p>
              </div>
              <Link to="/rankings" className="lp-text-link">
                Full rankings
              </Link>
            </div>
            {rankings.length === 0 ? (
              <p className="lp-muted">Rankings appear once tournaments are completed.</p>
            ) : (
              <ol className="lp-rankings">
                {rankings.map((r) => (
                  <li key={r.id}>
                    <Link to={`/players/${r.id}`}>
                      <span className="lp-rank-pos">#{r.rank_ireland ?? '—'}</span>
                      <span className="lp-rank-name">{r.full_name}</span>
                      <span className="lp-rank-uni">{r.university_short || '—'}</span>
                      <span className="lp-rank-pts">{r.points}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section className="lp-section lp-section-alt">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <div>
                <h2>Universities</h2>
                <p>Represent your campus.</p>
              </div>
            </div>
            <div className="lp-unis">
              {universities.map((u) => (
                <div key={u.id} className="lp-uni">
                  <strong>{u.short_name}</strong>
                  <span>{u.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-grid">
          <div>
            <strong>Student Padel Ireland</strong>
            <p>Tournaments, entries, and live scores for student padel.</p>
          </div>
          <div className="lp-footer-links">
            <a href="#tournaments">Tournaments</a>
            <Link to="/rankings">Rankings</Link>
            <Link to="/signup">Sign up</Link>
            <a href="mailto:hello@studentpadelireland.ie">Contact</a>
          </div>
        </div>
        <div className="lp-wrap lp-footer-copy">
          © {new Date().getFullYear()} Student Padel Ireland
        </div>
      </footer>
    </div>
  )
}
