import { useNavigate } from 'react-router-dom'
import { hapticLight } from '../native/haptics'
import { isNativeApp } from '../native/platform'
import './BackButton.css'

type Props = {
  /** Fallback when there is no in-app history (deep link / cold start). */
  fallbackTo?: string
  label?: string
  className?: string
  /**
   * Native apps use the top-bar back control by default.
   * Pass true for screens without NavBar (rare) or when you need an in-page control.
   */
  force?: boolean
  /** Icon-only control for the native top bar */
  compact?: boolean
}

/** App-style back control with a safe fallback for cold starts. */
export default function BackButton({
  fallbackTo = '/tournaments',
  label = 'Back',
  className = '',
  force = false,
  compact = false,
}: Props) {
  const navigate = useNavigate()

  // Avoid double backs — NavBar owns navigation chrome on native
  if (isNativeApp() && !force) return null

  const onBack = () => {
    void hapticLight()
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1)
      return
    }
    navigate(fallbackTo)
  }

  return (
    <button
      type="button"
      className={`back-btn ${compact ? 'back-btn--compact' : ''} ${className}`.trim()}
      onClick={onBack}
      aria-label={label}
    >
      <i className="fas fa-chevron-left" aria-hidden />
      {!compact ? <span>{label}</span> : null}
    </button>
  )
}
