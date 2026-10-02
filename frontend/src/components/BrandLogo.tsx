import { Link } from 'react-router-dom'

const LOGO_SRC = '/images/logo.png'

type Size = 'sm' | 'md' | 'lg' | 'xl'

type Props = {
  /** Link target. Pass null for a non-clickable mark. */
  to?: string | null
  className?: string
  size?: Size
  showText?: boolean
  /** Accessible name when used without visible text */
  label?: string
  onClick?: () => void
}

const SIZE_PX: Record<Size, { w: number; h: number }> = {
  sm: { w: 14, h: 18 },
  md: { w: 18, h: 24 },
  lg: { w: 24, h: 32 },
  xl: { w: 36, h: 48 },
}

export default function BrandLogo({
  to = '/',
  className = '',
  size = 'sm',
  showText = true,
  label = 'Student Padel Ireland',
  onClick,
}: Props) {
  const dims = SIZE_PX[size]
  const classes = ['brand-logo', `brand-logo--${size}`, className].filter(Boolean).join(' ')

  const inner = (
    <>
      <img
        src={LOGO_SRC}
        alt=""
        className="brand-logo-mark"
        width={dims.w}
        height={dims.h}
        decoding="async"
      />
      {showText ? <span className="brand-logo-text">{label}</span> : null}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={classes} aria-label={showText ? undefined : label} onClick={onClick}>
        {inner}
      </Link>
    )
  }

  return (
    <span className={classes} aria-label={showText ? undefined : label} role="img">
      {inner}
    </span>
  )
}
