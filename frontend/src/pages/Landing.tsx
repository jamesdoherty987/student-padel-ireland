import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { tournamentApi, type Tournament } from '../services/api'
import { formatDoublesEntry, parseCalendarDate, statusBadgeClass, statusLabel } from '../utils/format'
import { FlipWords } from '../components/ui/FlipWords'
import { InfiniteMovingCards } from '../components/ui/InfiniteMovingCards'
import { Globe } from '../components/ui/Globe'
import { HERO_ROTATION, LANDING_VIDEO } from '../data/landingImages'
import './Landing.css'

const CITY_WORDS = ['Dublin', 'Cork', 'Galway', 'Limerick', 'Belfast', 'Waterford']

const CITY_CARDS = [
  { title: 'Dublin', subtitle: 'Student padel' },
  { title: 'Cork', subtitle: 'Student padel' },
  { title: 'Galway', subtitle: 'Student padel' },
  { title: 'Limerick', subtitle: 'Student padel' },
  { title: 'Belfast', subtitle: 'Student padel' },
  { title: 'Waterford', subtitle: 'Student padel' },
]

const STEPS = [
  { n: '1', title: 'Find an event', body: 'Browse open tournaments near you.' },
  { n: '2', title: 'Register your team', body: 'Sign up with your partner and pay online.' },
  { n: '3', title: 'Play with friends', body: 'Start a private competition, share a code, confirm scores.' },
]

function eventDay(iso: string) {
  const d = parseCalendarDate(iso)
  return {
    day: d.toLocaleDateString('en-IE', { day: 'numeric' }),
    month: d.toLocaleDateString('en-IE', { month: 'short' }),
  }
}

export default function Landing() {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [heroIndex, setHeroIndex] = useState(0)
  const featureVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('mobile-menu-open', menuOpen)
    return () => document.body.classList.remove('mobile-menu-open')
  }, [menuOpen])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) setMenuOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || HERO_ROTATION.length < 2) return
    const id = window.setInterval(() => {
      setHeroIndex((i) => (i + 1) % HERO_ROTATION.length)
    }, 3000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const el = featureVideoRef.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      el.removeAttribute('autoplay')
      el.pause()
      return
    }

    const tryPlay = () => {
      void el.play().catch(() => {})
    }

    tryPlay()

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) tryPlay()
        else el.pause()
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const { data: tournaments = [], isLoading, isError } = useQuery({
    queryKey: ['tournaments', 'upcoming'],
    queryFn: async () => (await tournamentApi.list({ upcoming: true })).data,
  })

  const upcoming = tournaments.slice(0, 6)
  const close = () => setMenuOpen(false)
  const isOrganiser = user?.role === 'ORGANISER' || user?.role === 'ADMIN'
  const primaryHref = user?.role === 'ADMIN' ? '/admin' : isOrganiser ? '/organiser' : user ? '/tournaments' : '/signup'
  const primaryLabel = user?.role === 'ADMIN' ? 'Admin' : isOrganiser ? 'Dashboard' : user ? 'Tournaments' : 'Sign up'

  return (
    <div className="landing">
      <header className={`lp-header ${scrolled ? 'is-scrolled' : ''} ${menuOpen ? 'is-menu-open' : ''}`}>
        <div className="lp-header-inner">
          <a href="#top" className="lp-logo" onClick={close}>
            Student Padel Ireland
          </a>
          <nav className={`lp-nav ${menuOpen ? 'is-open' : ''}`}>
            <Link to="/tournaments" onClick={close}>
              Tournaments
            </Link>
            <a href="#how" onClick={close}>
              How it works
            </a>
            <Link to="/community" onClick={close}>
              Community
            </Link>
            <Link to="/rankings" onClick={close}>
              Rankings
            </Link>
            {user ? (
              <Link to={primaryHref} className="lp-btn lp-btn-solid" onClick={close}>
                {primaryLabel}
              </Link>
            ) : (
              <>
                <Link to="/login" onClick={close}>
                  Log in
                </Link>
                <Link to="/signup" className="lp-btn lp-btn-solid" onClick={close}>
                  Sign up
                </Link>
              </>
            )}
          </nav>
          <button
            type="button"
            className="lp-menu-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <i className={`fas ${menuOpen ? 'fa-times' : 'fa-bars'}`} />
          </button>
        </div>
      </header>

      <main id="top">
        <section className="lp-hero">
          <div className="lp-hero-media" aria-hidden>
            {HERO_ROTATION.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                className={i === heroIndex ? 'is-active' : undefined}
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            ))}
            <div className="lp-hero-scrim" />
          </div>
          <div className="lp-hero-content">
            <h1>Student Padel Ireland</h1>
            <p className="lp-lead">
              Find a game in <FlipWords words={CITY_WORDS} duration={900} className="lp-flip" />
            </p>
            <div className="lp-actions">
              <a href="#upcoming" className="lp-btn lp-btn-primary">
                Upcoming events
              </a>
              {!user && (
                <Link to="/signup" className="lp-btn lp-btn-ghost">
                  Sign up
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="lp-marquee" aria-label="Cities across Ireland">
          <InfiniteMovingCards items={CITY_CARDS} speed="normal" />
        </section>

        <section id="upcoming" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <div>
                <p className="lp-kicker">This season</p>
                <h2>Upcoming events</h2>
              </div>
              <Link to="/tournaments" className="lp-link">
                View all
              </Link>
            </div>

            {isLoading && (
              <div className="lp-stack">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton lp-skel" />
                ))}
              </div>
            )}
            {isError && <p className="lp-muted">Could not load events.</p>}
            {!isLoading && !isError && upcoming.length === 0 && (
              <div className="lp-empty-card">
                <p>No upcoming events yet.</p>
                <Link to="/tournaments" className="lp-link">
                  Browse tournaments
                </Link>
              </div>
            )}

            <ul className="lp-stack">
              {upcoming.map((t: Tournament) => {
                const { day, month } = eventDay(t.event_date)
                return (
                  <li key={t.id}>
                    <Link to={`/t/${t.slug}`} className="lp-event">
                      <div className="lp-event-date" aria-hidden>
                        <span>{month}</span>
                        <strong>{day}</strong>
                      </div>
                      <div className="lp-event-body">
                        <h3>{t.name}</h3>
                        <p>
                          {t.location} · {t.venue}
                        </p>
                      </div>
                      <div className="lp-event-side">
                        <span className={`badge ${statusBadgeClass(t.status)}`}>{statusLabel(t.status)}</span>
                        <span className="lp-event-fee">
                          {formatDoublesEntry(t.registered_teams, t.max_teams, t.entry_fee_cents, t.currency)}
                        </span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <section id="how" className="lp-section lp-section-muted">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2>How it works</h2>
            </div>
            <div className="lp-hover-grid">
              {STEPS.map((step) => (
                <div key={step.n} className="lp-hover-card">
                  <span className="lp-hover-num">{step.n}</span>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>
            <figure className="lp-shot lp-shot-wide lp-shot-video">
              <video
                ref={featureVideoRef}
                className="lp-feature-video"
                poster={LANDING_VIDEO.poster}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                aria-label="Padel match footage"
              >
                <source src={LANDING_VIDEO.mp4} type="video/mp4" />
              </video>
            </figure>
          </div>
        </section>

        <section className="lp-globe-section">
          <div className="lp-wrap lp-split lp-split-globe">
            <div>
              <p className="lp-kicker lp-kicker-light">Worldwide</p>
              <h2>Join the fastest-growing sport on earth</h2>
              <p>
                Tournaments, private ladders, and Ireland rankings — starting with Dublin, Cork, Galway, Limerick,
                Belfast and Waterford.
              </p>
              <a href="#upcoming" className="lp-btn lp-btn-primary">
                See upcoming events
              </a>
            </div>
            <div className="lp-globe-stage">
              <Globe />
            </div>
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-wrap lp-cta-inner">
            <h2>Ready to play?</h2>
            <Link to={user ? '/tournaments' : '/signup'} className="lp-btn lp-btn-primary">
              {user ? 'Browse tournaments' : 'Get started'}
            </Link>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-row">
          <span>Student Padel Ireland</span>
          <div className="lp-footer-links">
            <a href="#upcoming">Upcoming</a>
            <a href="mailto:hello@studentpadelireland.ie">Contact</a>
          </div>
        </div>
        <div className="lp-wrap lp-footer-copy">© {new Date().getFullYear()} Student Padel Ireland</div>
      </footer>
    </div>
  )
}
