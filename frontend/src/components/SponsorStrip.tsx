import type { MouseEvent } from 'react'
import { openExternalUrl } from '../native/shell'
import { mediaUrl } from '../utils/media'
import type { TournamentSponsor } from '../services/api'
import './SponsorStrip.css'

type Props = {
  sponsors: TournamentSponsor[]
  /** Slightly tighter strip for dense pages */
  compact?: boolean
}

/** Clean “Supported by” logo band — hidden when empty. */
export default function SponsorStrip({ sponsors, compact = false }: Props) {
  if (!sponsors.length) return null

  const onSponsorClick = (e: MouseEvent, website: string) => {
    e.preventDefault()
    void openExternalUrl(website)
  }

  return (
    <section className={`sponsor-strip${compact ? ' sponsor-strip--compact' : ''}`} aria-label="Sponsors">
      <p className="sponsor-strip-label">Supported by</p>
      <ul className="sponsor-strip-row">
        {sponsors.map((s) => {
          const src = mediaUrl(s.logo_url)
          const inner = src ? (
            <img src={src} alt={s.name} loading="lazy" decoding="async" />
          ) : (
            <span className="sponsor-strip-name">{s.name}</span>
          )
          const className = `sponsor-strip-item${s.level === 'MAIN' ? ' is-main' : ''}`
          if (s.website) {
            return (
              <li key={s.id}>
                <a
                  className={className}
                  href={s.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.name}
                  onClick={(e) => onSponsorClick(e, s.website!)}
                >
                  {inner}
                </a>
              </li>
            )
          }
          return (
            <li key={s.id}>
              <span className={className} title={s.name}>
                {inner}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
