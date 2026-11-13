import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { hapticLight } from '../native/haptics'
import { applyWaitingServiceWorker, softRefreshApp } from '../utils/appRefresh'

/** Small header control — soft-refreshes data; no “refreshing” popup. */
export default function HeaderReloadButton() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  const onReload = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    void hapticLight()
    try {
      await softRefreshApp(qc)
      const waiting = await applyWaitingServiceWorker()
      if (waiting) {
        // New shell is ready — silent reload, no confirm dialog
        window.setTimeout(() => window.location.reload(), 120)
        return
      }
    } finally {
      window.setTimeout(() => {
        lock.current = false
        setBusy(false)
      }, 450)
    }
  }

  return (
    <button
      type="button"
      className={`header-reload${busy ? ' is-busy' : ''}`}
      aria-label="Refresh"
      title="Refresh"
      disabled={busy}
      onClick={() => void onReload()}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12a9 9 0 1 1-2.6-6.2" strokeLinecap="round" />
        <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
