import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage, platformApi } from '../services/api'

export type InviteKind = 'tournament' | 'competition'

export type ResolvedInvite = {
  kind: InviteKind
  slug: string
  name: string
  invite_code: string
  join_path: string
  hint: string
}

export function cleanInviteCode(raw: string) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

/** Resolve any invite code (tournament event or friend competition). */
export async function resolveInviteCode(raw: string): Promise<ResolvedInvite> {
  const code = cleanInviteCode(raw)
  if (code.length < 6) {
    throw new Error('Enter the full invite code (at least 6 characters)')
  }
  const { data } = await platformApi.resolveInvite(code)
  return data
}

type JoinCodeBoxProps = {
  /** Extra class on the section wrapper */
  className?: string
  title?: string
  hint?: string
  placeholder?: string
  initialCode?: string
  /** Compact layout without section chrome */
  compact?: boolean
}

/**
 * One paste box that finds tournament OR community codes and sends you to the right place.
 */
export function JoinCodeBox({
  className = '',
  title = 'Have an invite code?',
  hint = 'Works for tournament events and friend-group competitions. Paste either code here.',
  placeholder = 'Paste invite code',
  initialCode = '',
  compact = false,
}: JoinCodeBoxProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [code, setCode] = useState(initialCode)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

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
      if (invite.kind === 'tournament') {
        setStatus(`Opening ${invite.name}…`)
        if (user) {
          navigate(invite.join_path)
        } else {
          navigate(`/login?next=${encodeURIComponent(invite.join_path)}`)
        }
        return
      }
      // Community competition
      setStatus(`Opening ${invite.name}…`)
      navigate(invite.join_path)
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'Invite code not found. Check it and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <>
      {!compact && title ? <h2 className="join-code-title">{title}</h2> : null}
      <form className="join-code-row" onSubmit={(e) => void onSubmit(e)}>
        <input
          className="form-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={placeholder}
          aria-label="Invite code"
          autoComplete="off"
          maxLength={12}
          inputMode="text"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-dark" disabled={busy || !code.trim()}>
          {busy ? 'Looking up…' : 'Join'}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {status && !error && <p className="muted-note">{status}</p>}
      {hint && <p className="muted-note join-code-hint">{hint}</p>}
    </>
  )

  if (compact) {
    return <div className={`join-code-box ${className}`.trim()}>{body}</div>
  }

  return <section className={`join-code-box join-code-panel ${className}`.trim()}>{body}</section>
}
