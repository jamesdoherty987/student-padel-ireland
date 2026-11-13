import { useState, type MouseEvent } from 'react'
import { openExternalUrl } from '../native/shell'
import { mediaUrl } from '../utils/media'
import type { TournamentSponsor } from '../services/api'
import './SponsorStrip.css'

type Props = {
  sponsors: TournamentSponsor[]
  /** Tighter spacing for live / join headers */
  compact?: boolean
  /** Under a page title */
  placement?: 'inline' | 'hero'
  /** TV / dark boards */
  tone?: 'light' | 'dark'
}

function SponsorLogo({ sponsor }: { sponsor: TournamentSponsor }) {
  const src = mediaUrl(sponsor.logo_url)
  const [broken, setBroken] = useState(false)
  const showLogo = !!src && !broken

  const onSponsorClick = (e: MouseEvent) => {
    if (!sponsor.website) return
    e.preventDefault()
    void openExternalUrl(sponsor.website)
  }

  const inner = showLogo ? (
    <img
      src={src}
      alt={sponsor.name}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="sponsor-strip-fallback">{sponsor.name}</span>
  )

  const className = ['sponsor-strip-logo', showLogo ? 'has-img' : 'name-only'].join(' ')

  if (sponsor.website) {
    return (
      <a
        className={className}
        href={sponsor.website}
        target="_blank"
        rel="noopener noreferrer"
        title={sponsor.name}
        aria-label={sponsor.name}
        onClick={onSponsorClick}
      >
        {inner}
      </a>
    )
  }

  return (
    <span className={className} title={sponsor.name} aria-label={sponsor.name}>
      {inner}
    </span>
  )
}

/**
 * Quiet logo band — logos first, no cards.
 * Featured (MAIN) sponsors lead; others follow in one row.
 */
export default function SponsorStrip({
  sponsors,
  compact = false,
  placement = 'inline',
  tone = 'light',
}: Props) {
  if (!sponsors.length) return null

  const featured = sponsors.filter((s) => s.level === 'MAIN')
  const rest = sponsors.filter((s) => s.level !== 'MAIN')
  const ordered = featured.length ? [...featured, ...rest] : sponsors
  const label =
    featured.length > 0 && featured.length === sponsors.length
      ? 'Presented by'
      : featured.length > 0
        ? 'Partners'
        : 'Supported by'

  return (
    <section
      className={[
        'sponsor-strip',
        compact ? 'sponsor-strip--compact' : '',
        placement === 'hero' ? 'sponsor-strip--hero' : '',
        tone === 'dark' ? 'sponsor-strip--dark' : '',
        `count-${Math.min(ordered.length, 8)}`,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Sponsors"
    >
      <p className="sponsor-strip-label">{label}</p>
      <ul className="sponsor-strip-logos">
        {ordered.map((s) => (
          <li key={s.id}>
            <SponsorLogo sponsor={s} />
          </li>
        ))}
      </ul>
    </section>
  )
}
