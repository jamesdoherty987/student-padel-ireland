import { useEffect, useState } from 'react'
import { Network, type ConnectionStatus } from '@capacitor/network'
import { apiBaseUrl, isNativeApp } from './platform'

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

/**
 * Capacitor and navigator.onLine both false-alarm often (esp. iOS WKWebView).
 * Prefer online whenever either signal looks connected.
 */
function signalsLookOnline(cap?: ConnectionStatus | null): boolean {
  if (browserOnline()) return true
  if (!cap) return false
  if (cap.connected) return true
  // connectionType can be wifi/cellular even when connected flips false briefly
  if (cap.connectionType && cap.connectionType !== 'none' && cap.connectionType !== 'unknown') {
    return true
  }
  return false
}

async function probeReachable(): Promise<boolean> {
  const base = apiBaseUrl()
  if (!base) {
    // No API configured — fall back to a public no-cors ping so we don't stick offline
    try {
      await fetch('https://www.studentpadel.ie/favicon.ico', {
        method: 'HEAD',
        cache: 'no-store',
        mode: 'no-cors',
      })
      return true
    } catch {
      return browserOnline()
    }
  }
  try {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${base.replace(/\/$/, '')}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    window.clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

/** Subscribe to online/offline. Never stick on a false Capacitor/browser offline. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    let cancelled = false
    let capStatus: ConnectionStatus | null = null
    let handle: { remove: () => Promise<void> } | undefined
    let probeTimer: number | undefined
    let probing = false

    const apply = (next: boolean) => {
      if (!cancelled) setOnline(next)
    }

    const recompute = () => {
      if (signalsLookOnline(capStatus)) {
        apply(true)
        return
      }
      // Both signals look offline — confirm with a real request before showing banner
      if (probing) return
      probing = true
      void probeReachable()
        .then((ok) => {
          if (cancelled) return
          apply(ok || signalsLookOnline(capStatus))
        })
        .finally(() => {
          probing = false
        })
    }

    const goOnline = () => apply(true)
    const goOffline = () => recompute()

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // While we think we're offline, keep re-checking — sticky false banners are worse
    // than a brief miss when truly offline.
    probeTimer = window.setInterval(() => {
      if (cancelled) return
      if (signalsLookOnline(capStatus)) {
        apply(true)
        return
      }
      recompute()
    }, 5000)

    if (isNativeApp()) {
      void (async () => {
        try {
          capStatus = await Network.getStatus()
          if (cancelled) return
          if (signalsLookOnline(capStatus)) apply(true)
          else recompute()
          handle = await Network.addListener('networkStatusChange', (s) => {
            capStatus = s
            if (signalsLookOnline(s)) apply(true)
            else recompute()
          })
          if (cancelled) {
            void handle.remove()
            handle = undefined
          }
        } catch {
          recompute()
        }
      })()
    } else if (!browserOnline()) {
      recompute()
    }

    return () => {
      cancelled = true
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      if (probeTimer) window.clearInterval(probeTimer)
      void handle?.remove()
    }
  }, [])

  return online
}
