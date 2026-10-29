import { useState, type MouseEvent } from 'react'
import { openExternalUrl } from '../native/shell'
import { mediaUrl } from '../utils/media'
import type { TournamentSponsor } from '../services/api'
import './SponsorStrip.css'

type Props = {
  sponsors: TournamentSponsor[]
  /** Slightly tighter strip for dense pages */
  compact?: boolean
  /** Sit under the title instead of mid-page */
  placement?: 'inline' | 'hero'
  /** For dark boards (TV display) */
  tone?: 'light' | 'dark'
}

function SponsorCard({
  sponsor,
  featured = false,
}: {
  sponsor: TournamentSponsor
  featured?: boolean
}) {
  const src = mediaUrl(sponsor.logo_url)
  const [broken, setBroken] = useState(false)
  const showLogo = !!src && !broken

  const onSponsorClick = (e: MouseEvent) => {
    if (!sponsor.website) return
    e.preventDefault()
    void openExternalUrl(sponsor.website)
  }

  const className = [
    'sponsor-strip-item',
    featured ? 'is-main' : '',
    showLogo ? 'has-logo' : 'name-only',
  ]
    .filter(Boolean)
    .join(' ')

  const inner = (
    <>
      <span className="sponsor-strip-mark" aria-hidden={!showLogo}>
        {showLogo ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="sponsor-strip-initial">{sponsor.name.slice(0, 1).toUpperCase()}</span>
        )}
      </span>
      <span className="sponsor-strip-name">{sponsor.name}</span>
    </>
  )

  if (sponsor.website) {
    return (
      <a
        className={className}
        href={sponsor.website}
        target="_blank"
        rel="noopener noreferrer"
        title={`Visit ${sponsor.name}`}
        onClick={onSponsorClick}
      >
        {inner}
      </a>
    )
  }

  return (
    <span className={className} title={sponsor.name}>
      {inner}
    </span>
  )
}

/** Clean “Supported by” logo band — hidden when empty. Always shows name + logo. */
export default function SponsorStrip({
  sponsors,
  compact = false,
  placement = 'inline',
  tone = 'light',
}: Props) {
  if (!sponsors.length) return null

  const featured = sponsors.filter((s) => s.level === 'MAIN')
  const rest = sponsors.filter((s) => s.level !== 'MAIN')
  const showFeatured = featured.length > 0
  // If nothing is featured, treat the list as one row (still show every name + logo)
  const rowSponsors = showFeatured ? rest : sponsors

  return (
    <section
      className={[
        'sponsor-strip',
        compact ? 'sponsor-strip--compact' : '',
        placement === 'hero' ? 'sponsor-strip--hero' : '',
        tone === 'dark' ? 'sponsor-strip--dark' : '',
        showFeatured ? 'has-featured' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Sponsors"
    >
      {showFeatured && (
        <div className="sponsor-strip-featured">
          <p className="sponsor-strip-label">Presented by</p>
          <ul className="sponsor-strip-featured-row">
            {featured.map((s) => (
              <li key={s.id}>
                <SponsorCard sponsor={s} featured />
              </li>
            ))}
          </ul>
        </div>
      )}

      {rowSponsors.length > 0 && (
        <div className="sponsor-strip-partners">
          <p className="sponsor-strip-label">
            {showFeatured ? 'Also supported by' : 'Supported by'}
          </p>
          <ul className="sponsor-strip-row">
            {rowSponsors.map((s) => (
              <li key={s.id}>
                <SponsorCard sponsor={s} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
