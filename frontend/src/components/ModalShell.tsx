import { useEffect, type PointerEvent, type ReactNode } from 'react'
import { scrollFieldAboveKeyboard, useKeyboardInset } from '../hooks/useKeyboardInset'

type Props = {
  title: string
  titleId?: string
  subtitle?: ReactNode
  onClose: () => void
  /** While true, Escape / backdrop / header close are ignored */
  preventClose?: boolean
  /**
   * Close when pressing the dimmed area. Uses pointerdown + target check so
   * selecting/deleting text in inputs cannot accidentally close the modal.
   */
  closeOnBackdrop?: boolean
  wide?: boolean
  className?: string
  children: ReactNode
  /** Sticky footer (actions). Rendered outside the scroll body when provided. */
  footer?: ReactNode
  headerExtra?: ReactNode
}

/**
 * Safe dialog shell: backdrop close only on a press that starts on the dimmed
 * area (not after dragging a text selection out of an input).
 */
export default function ModalShell({
  title,
  titleId = 'modal-title',
  subtitle,
  onClose,
  preventClose = false,
  closeOnBackdrop = true,
  wide = false,
  className = '',
  children,
  footer,
  headerExtra,
}: Props) {
  useKeyboardInset(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !preventClose) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, preventClose])

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (!t.closest('.modal')) return
      scrollFieldAboveKeyboard(t)
    }
    window.addEventListener('focusin', onFocus)
    return () => window.removeEventListener('focusin', onFocus)
  }, [])

  const requestClose = () => {
    if (!preventClose) onClose()
  }

  const onBackdropPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!closeOnBackdrop || preventClose) return
    if (e.target === e.currentTarget) requestClose()
  }

  return (
    <div className="modal-backdrop" onPointerDown={onBackdropPointerDown}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}${footer ? ' modal-with-footer' : ''} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="tf-modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <div className="tf-modal-sub">{subtitle}</div> : null}
          </div>
          <div className="tf-modal-head-actions">
            {headerExtra}
            <button type="button" className="btn btn-ghost btn-sm" onClick={requestClose} disabled={preventClose}>
              Close
            </button>
          </div>
        </header>

        <div className="modal-body">{children}</div>

        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}
