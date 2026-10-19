import { useNavigate } from 'react-router-dom'
import { hapticLight } from '../native/haptics'
import './BackButton.css'

type Props = {
  /** Fallback when there is no in-app history (deep link / cold start). */
  fallbackTo?: string
  label?: string
  className?: string
}

/** App-style back control with a safe fallback for cold starts. */
export default function BackButton({ fallbackTo = '/tournaments', label = 'Back', className = '' }: Props) {
  const navigate = useNavigate()

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
    <button type="button" className={`back-btn ${className}`.trim()} onClick={onBack}>
      <i className="fas fa-chevron-left" aria-hidden />
      <span>{label}</span>
    </button>
  )
}
