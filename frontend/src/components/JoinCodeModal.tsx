import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage } from '../services/api'
import { cleanInviteCode, resolveInviteCode } from '../utils/inviteCode'
import '../pages/Tournament.css'

type JoinCodeModalProps = {
  open: boolean
  onClose: () => void
  initialCode?: string
}

/** Popup to paste an invite code (tournament or friend group). QR deep links still use /join/:code. */
export function JoinCodeModal({ open, onClose, initialCode = '' }: JoinCodeModalProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState(initialCode)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setCode(initialCode)
    setError('')
    setStatus('')
    setBusy(false)
    document.body.classList.add('modal-open')
    const t = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => {
      window.clearTimeout(t)
      document.body.classList.remove('modal-open')
    }
  }, [open, initialCode])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setStatus('')
    const cleaned = cleanInviteCode(code)
    if (cleaned.length < 6) {
      setError('Enter the full invite code')
      return
    }
    setBusy(true)
    try {
      const invite = await resolveInviteCode(cleaned)
      setStatus(`Opening ${invite.name}…`)
      if (invite.kind === 'tournament') {
        if (user) navigate(invite.join_path)
        else navigate(`/login?next=${encodeURIComponent(invite.join_path)}`)
      } else {
        navigate(invite.join_path)
      }
      onClose()
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Invite code not found. Check it and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="join-modal-backdrop"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="join-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="join-modal-head">
          <h2 id={titleId}>Join with a code</h2>
          <button type="button" className="join-modal-close" aria-label="Close" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        <p className="join-modal-lead">Paste an invite code for a tournament or friend group.</p>
        <form className="join-code-row" onSubmit={(e) => void onSubmit(e)}>
          <input
            ref={inputRef}
            className="form-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. EHWDZA78"
            aria-label="Invite code"
            autoComplete="off"
            maxLength={12}
            inputMode="text"
            spellCheck={false}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
            {busy ? 'Looking up…' : 'Join'}
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
        {status && !error && <p className="muted-note">{status}</p>}
      </div>
    </div>
  )
}

type HaveCodeButtonProps = {
  className?: string
  children?: ReactNode
  initialCode?: string
  /** Open the modal when this becomes true (e.g. ?join=1). Caller should clear the flag. */
  autoOpen?: boolean
  onAutoOpened?: () => void
}

/** Header/action button that opens the join-code popup. */
export function HaveCodeButton({
  className = 'btn btn-ghost btn-sm',
  children = 'Have a code?',
  initialCode = '',
  autoOpen = false,
  onAutoOpened,
}: HaveCodeButtonProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!autoOpen) return
    setOpen(true)
    onAutoOpened?.()
  }, [autoOpen, onAutoOpened])

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <JoinCodeModal open={open} onClose={() => setOpen(false)} initialCode={initialCode} />
    </>
  )
}
