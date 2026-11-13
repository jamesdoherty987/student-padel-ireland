import { useEffect, useState } from 'react'
import { Network, type ConnectionStatus } from '@capacitor/network'
import { isNativeApp } from './platform'

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

/** Capacitor can briefly report connected=false / unknown while the device is online. */
function statusLooksOnline(status: ConnectionStatus): boolean {
  if (status.connectionType === 'none') return false
  if (status.connected) return true
  // Unknown / flaky plugin reads: trust the browser signal when available
  return browserOnline()
}

/** Subscribe to online/offline. Prefer “online” on ambiguous native reports. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(browserOnline)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => {
      // Only mark offline if the browser also agrees (avoids sticky false banners)
      if (!browserOnline()) setOnline(false)
    }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    if (!isNativeApp()) {
      return () => {
        window.removeEventListener('online', goOnline)
        window.removeEventListener('offline', goOffline)
      }
    }

    let cancelled = false
    let handle: { remove: () => Promise<void> } | undefined

    void (async () => {
      try {
        const status = await Network.getStatus()
        if (cancelled) return
        setOnline(statusLooksOnline(status))
        handle = await Network.addListener('networkStatusChange', (s) => {
          setOnline(statusLooksOnline(s))
        })
        if (cancelled) {
          void handle.remove()
          handle = undefined
        }
      } catch {
        /* Network plugin unavailable — keep browser events */
        setOnline(browserOnline())
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      void handle?.remove()
    }
  }, [])

  return online
}
