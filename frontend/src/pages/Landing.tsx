import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '../components/BrandLogo'
import { useAuth } from '../context/AuthContext'
import { tournamentApi, type Tournament } from '../services/api'
import { formatEntrySummary, parseCalendarDate, statusBadgeClass, statusLabel } from '../utils/format'
import { FlipWords } from '../components/ui/FlipWords'
import { InfiniteMovingCards } from '../components/ui/InfiniteMovingCards'
import { Globe } from '../components/ui/Globe'
import { HERO_ROTATION, LANDING_VIDEO } from '../data/landingImages'
import { setStatusBarForDarkScreen, setStatusBarForLightScreen } from '../native/statusBar'
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
  { n: '1', title: 'Find an event or use a code', body: 'Browse tournaments and tap to join, or use Have a code? / scan a QR if a friend invited you.' },
  { n: '2', title: 'Register with your partner', body: 'Sign up as a doubles team and pay online if there is a fee.' },
  { n: '3', title: 'Play and climb rankings', body: 'Match results from tournaments and community games update Ireland rankings.' },
]

function eventDay(iso: string) {
  const d = parseCalendarDate(iso)
  return {
    day: d.toLocaleDateString('en-IE', { day: 'numeric' }),
    month: d.toLocaleDateString('en-IE', { month: 'short' }),
  }
}

export default function Landing() {
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [heroIndex, setHeroIndex] = useState(0)
  const featureVideoRef = useRef<HTMLVideoElement>(null)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)

  useEffect(() => {
    if (menuOpen || scrolled) {
      void setStatusBarForLightScreen()
    } else {
      void setStatusBarForDarkScreen()
    }
    return () => {
      void setStatusBarForLightScreen()
    }
  }, [scrolled, menuOpen])

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
      if (window.innerWidth > 1024) setMenuOpen(false)
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
      el.pause()
      setVideoPlaying(false)
      return
    }

    let visible = false

    const tryPlay = () => {
      if (!visible || reduced) return
      const p = el.play()
      if (p !== undefined) {
        void p
          .then(() => {
            setVideoPlaying(true)
            setVideoFailed(false)
          })
          .catch(() => {
            setVideoPlaying(false)
          })
      }
    }

    const onPlaying = () => setVideoPlaying(true)
    const onPause = () => setVideoPlaying(!el.paused)
    const onError = () => {
      setVideoFailed(true)
      setVideoPlaying(false)
    }

    el.addEventListener('playing', onPlaying)
    el.addEventListener('pause', onPause)
    el.addEventListener('error', onError)
    el.addEventListener('loadeddata', tryPlay)
    el.addEventListener('canplay', tryPlay)

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        visible = entry.isIntersecting
        if (visible) tryPlay()
        else el.pause()
      },
      { threshold: 0.25 },
    )
    io.observe(el)

    // Kick load in case the browser deferred it
    el.load()

    return () => {
      io.disconnect()
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('error', onError)
      el.removeEventListener('loadeddata', tryPlay)
      el.removeEventListener('canplay', tryPlay)
    }
  }, [])

  const toggleFeatureVideo = () => {
    const el = featureVideoRef.current
    if (!el || videoFailed) return
    if (el.paused) {
      void el.play()
        .then(() => setVideoPlaying(true))
        .catch(() => setVideoPlaying(false))
    } else {
      el.pause()
      setVideoPlaying(false)
    }
  }

  const { data: tournaments = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['tournaments', 'upcoming'],
    queryFn: async () => (await tournamentApi.list({ upcoming: true })).data,
  })

  const upcoming = tournaments.slice(0, 6)
  const close = () => setMenuOpen(false)
  const primaryHref = user?.role === 'ADMIN' ? '/admin' : user ? '/tournaments' : '/signup'
  const primaryLabel = user?.role === 'ADMIN' ? 'Admin' : user ? 'Tournaments' : 'Sign up'

  return (
    <div className="landing">
      <header className={`lp-header ${scrolled ? 'is-scrolled' : ''} ${menuOpen ? 'is-menu-open' : ''}`}>
        <div className="lp-header-inner">
          <a href="#top" className="lp-logo" onClick={close}>
            <img src="/images/spi-logo.png" alt="" className="lp-logo-mark" width={54} height={73} />
            <span className="lp-logo-text">Student Padel Ireland</span>
          </a>
          <nav className={`lp-nav ${menuOpen ? 'is-open' : ''}`}>
            <Link to="/tournaments" onClick={close}>
              Tournaments
            </Link>
            <Link to="/community" onClick={close}>
              Community
            </Link>
            <a href="#how" onClick={close}>
              How it works
            </a>
            <Link to="/rankings" onClick={close}>
              Rankings
            </Link>
            {user ? (
              <>
                <Link to="/organiser" onClick={close}>
                  My events
                </Link>
                <Link to={`/players/${user.id}`} onClick={close}>
                  Profile
                </Link>
                <Link to={primaryHref} className="lp-btn lp-btn-solid" onClick={close}>
                  {primaryLabel}
                </Link>
                <button
                  type="button"
                  className="lp-nav-logout"
                  onClick={() => {
                    close()
                    logout()
                  }}
                >
                  Log out
                </button>
              </>
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
              <Link to="/tournaments?join=1" className="lp-btn lp-btn-ghost">
                Have a code?
              </Link>
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
            {isError && (
              <div className="lp-empty-card">
                <p>Could not load events.</p>
                <button type="button" className="lp-link" onClick={() => void refetch()}>
                  Retry
                </button>
              </div>
            )}
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
                          {formatEntrySummary(t.registered_teams, t.max_teams, t.entry_fee_cents, t.currency, t.play_format)}
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
                src={LANDING_VIDEO.mp4}
                poster={LANDING_VIDEO.poster}
                muted
                loop
                playsInline
                preload="auto"
                aria-label="Padel match footage"
                onClick={toggleFeatureVideo}
              />
              {!videoFailed && (
                <button
                  type="button"
                  className={`lp-video-play ${videoPlaying ? 'is-playing' : ''}`}
                  onClick={toggleFeatureVideo}
                  aria-label={videoPlaying ? 'Pause video' : 'Play video'}
                >
                  {videoPlaying ? (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
              )}
            </figure>
          </div>
        </section>

        <section className="lp-globe-section">
          <div className="lp-wrap lp-split lp-split-globe">
            <div>
              <p className="lp-kicker lp-kicker-light">Ireland</p>
              <h2>Student padel, across the country</h2>
              <p>
                Tournaments, private ladders, and one Ireland ranking. Dublin, Cork, Galway, Limerick, Belfast and
                Waterford.
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
          <BrandLogo to="/" className="lp-footer-brand" size="sm" />
          <div className="lp-footer-links">
            <a href="#upcoming">Upcoming</a>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <a href="mailto:hello@studentpadelireland.ie">Contact</a>
          </div>
        </div>
        <div className="lp-wrap lp-footer-copy">© {new Date().getFullYear()} Student Padel Ireland</div>
      </footer>
    </div>
  )
}
