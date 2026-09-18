import type { CSSProperties } from 'react'

export type MovingCardItem = {
  title: string
  subtitle: string
}

type InfiniteMovingCardsProps = {
  items: MovingCardItem[]
  direction?: 'left' | 'right'
  speed?: 'fast' | 'normal' | 'slow'
  className?: string
}

/** Aceternity infinite-moving-cards — CSS-driven for this app */
export function InfiniteMovingCards({
  items,
  direction = 'left',
  speed = 'normal',
  className = '',
}: InfiniteMovingCardsProps) {
  const duration = speed === 'fast' ? '28s' : speed === 'slow' ? '65s' : '42s'

  return (
    <div
      className={`moving-cards ${className}`.trim()}
      style={
        {
          '--mc-duration': duration,
          '--mc-direction': direction === 'left' ? 'normal' : 'reverse',
        } as CSSProperties
      }
    >
      <ul className="moving-cards-track">
        {[...items, ...items].map((item, i) => (
          <li key={`${item.title}-${i}`} className="moving-card" aria-hidden={i >= items.length}>
            <span className="moving-card-title">{item.title}</span>
            <span className="moving-card-sub">{item.subtitle}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
