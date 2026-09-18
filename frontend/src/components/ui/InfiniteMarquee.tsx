import type { CSSProperties, ReactNode } from 'react'

type InfiniteMarqueeProps = {
  children: ReactNode
  speed?: 'fast' | 'normal' | 'slow'
  direction?: 'left' | 'right'
  className?: string
}

/** Aceternity infinite-moving-cards pattern, CSS-driven */
export function InfiniteMarquee({
  children,
  speed = 'normal',
  direction = 'left',
  className = '',
}: InfiniteMarqueeProps) {
  const duration = speed === 'fast' ? '28s' : speed === 'slow' ? '70s' : '45s'

  return (
    <div
      className={`marquee ${className}`.trim()}
      style={
        {
          '--marquee-duration': duration,
          '--marquee-direction': direction === 'left' ? 'normal' : 'reverse',
        } as CSSProperties
      }
    >
      <div className="marquee-track">
        <div className="marquee-group">{children}</div>
        <div className="marquee-group" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  )
}
