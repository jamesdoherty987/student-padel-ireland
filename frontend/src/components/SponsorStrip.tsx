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
  size = 'tile',
}: {
  sponsor: TournamentSponsor
  /** solo = fills the strip; lead = featured row; tile = grid cell */
  size?: 'solo' | 'lead' | 'tile'
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
    `is-${size}`,
    showLogo ? 'has-logo' : 'name-only',
  ].join(' ')

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
      <span className="sponsor-strip-copy">
        <span className="sponsor-strip-name">{sponsor.name}</span>
        {sponsor.website ? <span className="sponsor-strip-link-hint">Visit site</span> : null}
      </span>
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

  const solo = sponsors.length === 1
  const featured = sponsors.filter((s) => s.level === 'MAIN')
  const rest = sponsors.filter((s) => s.level !== 'MAIN')
  // One sponsor always gets the full-width treatment, featured or not
  const showFeaturedBlock = !solo && featured.length > 0
  const rowSponsors = showFeaturedBlock ? rest : sponsors
  const label = solo
    ? featured.length || sponsors[0]?.level === 'MAIN'
      ? 'Presented by'
      : 'Supported by'
    : showFeaturedBlock
      ? 'Also supported by'
      : 'Supported by'

  return (
    <section
      className={[
        'sponsor-strip',
        compact ? 'sponsor-strip--compact' : '',
        placement === 'hero' ? 'sponsor-strip--hero' : '',
        tone === 'dark' ? 'sponsor-strip--dark' : '',
        solo ? 'is-solo' : 'is-multi',
        showFeaturedBlock ? 'has-featured' : '',
        `count-${Math.min(sponsors.length, 6)}`,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Sponsors"
    >
      {solo && (
        <div className="sponsor-strip-solo">
          <p className="sponsor-strip-label">{label}</p>
          <SponsorCard sponsor={sponsors[0]} size="solo" />
        </div>
      )}

      {!solo && showFeaturedBlock && (
        <div className="sponsor-strip-featured">
          <p className="sponsor-strip-label">Presented by</p>
          <ul
            className={`sponsor-strip-featured-row count-${Math.min(featured.length, 4)}`}
          >
            {featured.map((s) => (
              <li key={s.id}>
                <SponsorCard sponsor={s} size={featured.length === 1 ? 'solo' : 'lead'} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!solo && rowSponsors.length > 0 && (
        <div className="sponsor-strip-partners">
          <p className="sponsor-strip-label">{label}</p>
          <ul
            className={`sponsor-strip-row count-${Math.min(rowSponsors.length, 6)}`}
          >
            {rowSponsors.map((s) => (
              <li key={s.id}>
                <SponsorCard sponsor={s} size="tile" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
